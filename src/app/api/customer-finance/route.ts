import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { canWriteCustomerFinance, financeScopeError, financeWriteRoles } from "../../../lib/customer-finance-access";
import { parseCustomerFinanceInput, type CustomerFinanceInput } from "../../../lib/validation";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { entryDateError } from "../../../lib/entry-date-validation";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, rowsLimitError, tooLargeResponse } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";
import { hasAnyRole } from "../../../lib/role-access";

type FieldErrors = Record<string, string[]>;

function getRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows)) return (body as { rows: unknown[] }).rows;
  return [body];
}

export async function POST(request: Request) {
  let sessionUser;
  try { sessionUser = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!hasAnyRole(sessionUser, financeWriteRoles))
    return authorizationDenied(sessionUser, "只有组长和负责客户的专家可以登记资金流水");

  try {
    const rawRows = getRows(await readLimitedJson(request, API_LIMITS.customerFinanceBodyBytes));
    if (!rawRows.length) return NextResponse.json({ error: "请至少填写一条财务流水" }, { status: 400 });
    const limitError = rowsLimitError(rawRows.length, API_LIMITS.customerFinanceRows, "财务流水");
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });
    const fields: FieldErrors = {};
    const rows = rawRows.map((raw, index): CustomerFinanceInput | null => {
      try { return parseCustomerFinanceInput(raw); }
      catch (error) {
        if (error instanceof ZodError) error.issues.forEach((issue) => { fields[`rows.${index}.${issue.path.join(".")}`] = [issue.message]; });
        else throw error;
        return null;
      }
    });
    const validRows = rows.flatMap((row, index) => row ? [{ row, index }] : []);
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(sessionUser, settings.timezone);
    const today = localDateYYYYMMDD(new Date(), timezone);
    validRows.forEach(({ row, index }) => {
      const error = entryDateError(row.occurredOn, today, "流水日期");
      if (error) fields[`rows.${index}.occurredOn`] = [error];
    });
    const seenContinuation = new Set<string>();
    validRows.forEach(({ row, index }) => {
      if (row.kind !== "RECHARGE") return;
      const key = `${row.customerOrderId}:${row.continuationNumber}`;
      if (seenContinuation.has(key)) fields[`rows.${index}.continuationNumber`] = ["同一号码的续充次数不能重复"];
      seenContinuation.add(key);
    });
    if (Object.keys(fields).length) return NextResponse.json({ error: "请检查填写内容", fields }, { status: 400 });

    const result = await db.$transaction(async (transaction) => {
      const actor = await transaction.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, active: true, role: true, groupId: true, roleAssignments: { select: { role: true } } } });
      if (!actor?.active || !hasAnyRole(actor, financeWriteRoles)) return { status: 403 as const, error: "当前账号不能录入资金流水" };
      const orders = await transaction.customerOrder.findMany({
        where: { id: { in: validRows.map(({ row }) => row.customerOrderId) } },
        include: {
          batch: { select: { groupId: true } },
          lead: { select: { ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true, currentGroupId: true } },
          events: { where: { kind: "RECHARGE", continuationNumber: { not: null } }, select: { id: true, continuationNumber: true, voidedAt: true } },
        },
      });
      const orderById = new Map(orders.map((order) => [order.id, order]));
      for (const { row, index } of validRows) {
        const order = orderById.get(row.customerOrderId);
        if (!order || !canWriteCustomerFinance(actor, order)) {
          fields[`rows.${index}.customerOrderId`] = [financeScopeError(actor.role)];
          continue;
        }
        if (order.voidedAt) {
          fields[`rows.${index}.customerOrderId`] = ["该开单记录已作废，不能继续登记资金"];
          continue;
        }
        if (row.occurredOn < order.openedOn) fields[`rows.${index}.occurredOn`] = ["流水日期不能早于开单日期"];
        if (row.kind === "RECHARGE" && order.events.some((event) => event.continuationNumber === row.continuationNumber && !event.voidedAt)) {
          fields[`rows.${index}.continuationNumber`] = [`该号码的第 ${row.continuationNumber} 次续充已经登记`];
        }
      }
      if (Object.keys(fields).length) return { status: 400 as const, error: "请检查填写内容" };

      const events = [];
      for (const { row } of validRows) {
        const order = orderById.get(row.customerOrderId)!;
        const previous = row.kind === "RECHARGE" ? order.events.find((event) => event.continuationNumber === row.continuationNumber && event.voidedAt) : undefined;
        const data = {
          batchId: order.batchId, enteredById: actor.id, occurredOn: row.occurredOn, kind: row.kind,
          amountCents: row.amountCents, customerOrderId: order.id,
          depositMethod: row.kind === "RECHARGE" ? row.depositMethod : null,
          continuationNumber: row.kind === "RECHARGE" ? row.continuationNumber : null,
        };
        events.push(previous
          ? await transaction.customerFinanceEvent.update({ where: { id: previous.id }, data: { ...data, voidedAt: null, voidReason: null, voidedById: null } })
          : await transaction.customerFinanceEvent.create({ data }));
      }
      return { status: 201 as const, events };
    });
    if (!result.events) return result.status === 403
      ? authorizationDenied(sessionUser, result.error)
      : NextResponse.json({ error: result.error, fields }, { status: result.status });
    return NextResponse.json({ saved: result.events.length, events: result.events }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "该号码的这一次续充已经登记" }, { status: 409 });
    }
    throw error;
  }
}
