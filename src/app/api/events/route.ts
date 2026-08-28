import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { touchDailyEntryConfirmations } from "../../../lib/daily-confirmations";
import { recordMetricEvent } from "../../../lib/metric-events";
import { parseMetricInput, type MetricInput } from "../../../lib/validation";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { entryDateError } from "../../../lib/entry-date-validation";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, rowsLimitError, tooLargeResponse } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

type FieldErrors = Record<string, string[]>;
const errorResponse = (fields: FieldErrors, error = "请检查填写内容") => NextResponse.json({ error, fields }, { status: 400 });

function getInputs(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)) return (body as { events: unknown[] }).events;
  return [body];
}

export async function POST(request: Request) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (user.role !== "RECEPTION")
    return authorizationDenied(user, "只有前台接粉可以录入业务数据");
  try {
    const rawInputs = getInputs(await readLimitedJson(request, API_LIMITS.eventBodyBytes));
    if (!rawInputs.length) return errorResponse({}, "请至少填写一条记录");
    const limitError = rowsLimitError(rawInputs.length, API_LIMITS.eventRows, "业务记录");
    if (limitError) return errorResponse({}, limitError);
    const fields: FieldErrors = {};
    const inputs = rawInputs.map((raw, index): MetricInput | null => {
      try { return parseMetricInput(raw); }
      catch (error) {
        if (error instanceof ZodError) error.issues.forEach((issue) => { fields[`rows.${index}.${issue.path.join(".")}`] = [issue.message]; });
        else throw error;
        return null;
      }
    });
    const validInputs = inputs.flatMap((input, index) => input ? [{ input, index }] : []);
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
    const today = localDateYYYYMMDD(new Date(), timezone);
    validInputs.forEach(({ input, index }) => {
      const error = entryDateError(input.occurredOn, today, "业务日期");
      if (error) fields[`rows.${index}.occurredOn`] = [error];
    });
    if (Object.keys(fields).length) return errorResponse(fields);
    const result = await db.$transaction(async (transaction) => {
      const currentUser = await transaction.user.findUnique({
        where: { id: user.id },
        select: { id: true, role: true, groupId: true, active: true },
      });
      const batches = await transaction.sourceBatch.findMany({
        where: { id: { in: validInputs.map(({ input }) => input.batchId) } },
        include: { group: true, channel: true },
      });
      const parentIds = validInputs.flatMap(({ input }) => input.kind === "GROUP_LEAVE" && input.parentEventId ? [input.parentEventId] : []);
      const parentEvents = await transaction.metricEvent.findMany({
        where: { id: { in: parentIds } },
        include: { childEvents: { where: { kind: "GROUP_LEAVE" }, select: { quantity: true } } },
      });
      const parentById = new Map(parentEvents.map((event) => [event.id, event]));
      const pendingLeaves = new Map<string, number>();
      const batchById = new Map(batches.map((batch) => [batch.id, batch]));
      let forbidden = false;
      for (const { input, index } of validInputs) {
        const batch = batchById.get(input.batchId);
        if (!batch) fields[`rows.${index}.batchId`] = ["来源批次不存在"];
        else if (!batch.group.active || !batch.channel.active) fields[`rows.${index}.batchId`] = ["来源批次已停用"];
        else if (!currentUser?.active || currentUser.role !== "RECEPTION" || !currentUser.groupId || currentUser.groupId !== batch.groupId) {
          fields[`rows.${index}.batchId`] = ["没有权限写入该来源批次"];
          forbidden = true;
        }
        if (input.kind === "GROUP_LEAVE" && input.parentEventId) {
          const parent = parentById.get(input.parentEventId);
          if (!parent || parent.kind !== "GROUP_JOIN" || parent.batchId !== input.batchId || parent.enteredById !== currentUser?.id) {
            fields[`rows.${index}.parentEventId`] = ["原入群记录不存在，或不属于当前账号和来源批次"];
            forbidden = Boolean(parent && parent.enteredById !== currentUser?.id);
          } else {
            const alreadyLeft = parent.childEvents.reduce((sum, event) => sum + (event.quantity ?? 0), 0);
            const pending = pendingLeaves.get(parent.id) ?? 0;
            const remaining = (parent.quantity ?? 0) - alreadyLeft - pending;
            if ((input.quantity ?? 0) > remaining) {
              fields[`rows.${index}.quantity`] = [`退群数量不能超过当前剩余在群人数 ${Math.max(0, remaining)}`];
            } else {
              pendingLeaves.set(parent.id, pending + (input.quantity ?? 0));
            }
          }
        }
      }
      if (Object.keys(fields).length) return { events: null, forbidden };
      const events = await Promise.all(validInputs.map(({ input }) => recordMetricEvent(transaction, { ...input, enteredById: currentUser!.id })));
      await touchDailyEntryConfirmations(transaction, currentUser!.id, validInputs.map(({ input }) => input.occurredOn));
      return { events, forbidden: false };
    });
    if (!result.events) {
      return result.forbidden
        ? authorizationDenied(user, "请检查填写内容", { fields })
        : errorResponse(fields);
    }

    const events = result.events;
    return NextResponse.json({ saved: validInputs.length, events }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
