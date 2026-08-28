import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db, getOrCreateSourceBatch } from "../../../lib/db";
import { ChannelResolutionError, isConcurrentChannelCreateError, isRetryableSqliteTransactionError, resolveOrCreateChannel } from "../../../lib/channels";
import { parseNewFansInput, type NewFansInput } from "../../../lib/validation";
import { touchDailyEntryConfirmations } from "../../../lib/daily-confirmations";
import { recordMetricEvent } from "../../../lib/metric-events";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { entryDateError } from "../../../lib/entry-date-validation";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, rowsLimitError, tooLargeResponse } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

type FieldErrors = Record<string, string[]>;
const errorResponse = (fields: FieldErrors, error = "请检查填写内容") => NextResponse.json({ error, fields }, { status: 400 });
const MAX_TRANSACTION_ATTEMPTS = 3;

class BatchTransactionBusyError extends Error {}

async function retryBatchTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = isRetryableSqliteTransactionError(error) || isConcurrentChannelCreateError(error);
      if (!retryable) throw error;
      if (attempt === MAX_TRANSACTION_ATTEMPTS) throw new BatchTransactionBusyError("系统正忙，请稍后重试");
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw new BatchTransactionBusyError("系统正忙，请稍后重试");
}

function getRows(body: unknown): unknown[] {
  if (body && typeof body === "object" && Array.isArray((body as { batches?: unknown }).batches)) return (body as { batches: unknown[] }).batches;
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
    return authorizationDenied(user, "只有前台接粉可以录入提交号码数据");

  try {
    const rows = getRows(await readLimitedJson(request, API_LIMITS.batchBodyBytes));
    if (!rows.length) return errorResponse({}, "请至少填写一条提交号码记录");
    const limitError = rowsLimitError(rows.length, API_LIMITS.batchRows, "提交号码");
    if (limitError) return errorResponse({}, limitError);
    const fields: FieldErrors = {};
    const inputs = rows.map((row, index): NewFansInput | null => {
      try { return parseNewFansInput(row); }
      catch (error) {
        if (error instanceof ZodError) error.issues.forEach((issue) => { fields[`batches.${index}.${issue.path.join(".")}`] = [issue.message]; });
        else throw error;
        return null;
      }
    });

    if (Object.keys(fields).length) return errorResponse(fields);
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
    const today = localDateYYYYMMDD(new Date(), timezone);
    inputs.forEach((input, index) => {
      if (!input) return;
      const error = entryDateError(input.sourceDate, today, "来源日期");
      if (error) fields[`batches.${index}.sourceDate`] = [error];
    });
    if (Object.keys(fields).length) return errorResponse(fields);

    const result = await retryBatchTransaction(() => db.$transaction(async (transaction) => {
      const saved = [];
      for (const [index, input] of inputs.entries()) {
        if (!input) throw new Error("Validated input unexpectedly missing");
        const raw = rows[index] as { groupId?: unknown };
        try {
          const channel = await resolveOrCreateChannel(transaction, {
            actor: user,
            groupId: typeof raw.groupId === "string" ? raw.groupId : undefined,
            channelId: input.channelId,
            channelName: input.channelName,
          });
          const batch = await getOrCreateSourceBatch({ groupId: channel.groupId, channelId: channel.id, sourceDate: input.sourceDate }, transaction);
          const events = await Promise.all([
            ["NEW_FANS", input.quantity],
            ["EFFECTIVE_FANS", input.effectiveFans],
            ["NO_NUMBER", input.noNumber],
            ["DUPLICATE_FANS", input.duplicateFans],
          ].map(([kind, quantity]) => recordMetricEvent(transaction, {
            batchId: batch.id,
            enteredById: user.id,
            occurredOn: input.sourceDate,
            kind: kind as "NEW_FANS" | "EFFECTIVE_FANS" | "NO_NUMBER" | "DUPLICATE_FANS",
            quantity: quantity as number,
          })));
          saved.push({ batch, event: events[0] });
        } catch (error) {
          if (error instanceof ChannelResolutionError) {
            throw Object.assign(error, { rowIndex: index, field: input.channelName ? "channelName" : "channelId" });
          }
          throw error;
        }
      }
      await touchDailyEntryConfirmations(transaction, user.id, inputs.flatMap((input) => input ? [input.sourceDate] : []));
      return saved;
    }));
    return NextResponse.json({ saved: result.length, batches: result.map(({ batch }) => batch) }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    if (error instanceof ChannelResolutionError) {
      const detail = error as ChannelResolutionError & { rowIndex?: number; field?: string };
      return errorResponse({ [`batches.${detail.rowIndex ?? 0}.${detail.field ?? "channelId"}`]: [error.message] }, error.message);
    }
    if (error instanceof BatchTransactionBusyError) return errorResponse({}, error.message);
    throw error;
  }
}
