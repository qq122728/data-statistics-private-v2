import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { normalizeCustomerPhone } from "../../../lib/entry-ledger";
import { parseCustomerOrderInput, type CustomerOrderInput } from "../../../lib/validation";
import { customerOrderWriteRoles, getAssignedRoles, hasAnyRole, isFrontlineGroupMember } from "../../../lib/role-access";
import { canWriteCustomerRevenue } from "../../../lib/permissions";
import { statisticsDate } from "../../../lib/statistics-date";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { entryDateError } from "../../../lib/entry-date-validation";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, rowsLimitError, tooLargeResponse } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";
import { syncCustomerOrderEvent } from "../../../lib/customer-number-event-sync";

type FieldErrors = Record<string, string[]>;

function getRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows)) {
    return (body as { rows: unknown[] }).rows;
  }
  return [body];
}

function normalizeCustomerOrderIdentifier(value: string): string {
  return normalizeCustomerPhone(value);
}

function customerScope(user: { id: string; role: Parameters<typeof getAssignedRoles>[0]["role"]; groupId: string | null; active: boolean; roleAssignments?: Array<{ role: Parameters<typeof getAssignedRoles>[0]["role"] }> }): Prisma.CustomerOrderWhereInput {
  if (user.role === "ADMIN") return {};
  const roles = getAssignedRoles(user);
  if (roles.includes("LEAD")) return { lead: { OR: [{ currentGroupId: user.groupId ?? "__none__" }, { currentGroupId: null, batch: { groupId: user.groupId ?? "__none__" } }] } };
  if (!isFrontlineGroupMember(user)) return { id: "__none__" };
  const currentGroup = { OR: [
    { currentGroupId: user.groupId ?? "__none__" },
    { currentGroupId: null, batch: { groupId: user.groupId ?? "__none__" } },
  ] } satisfies Prisma.LeadCustomerWhereInput;
  return { lead: { AND: [{ OR: [
    { attributionOwnerId: user.id },
    { ownerId: user.id },
    { groupOperatorOwnerId: user.id },
    { expertOwnerId: user.id },
  ] }, currentGroup] } };
}

export async function GET() {
  try {
    const user = await requireUser();
    const orders = await db.customerOrder.findMany({
      where: customerScope(user),
      include: {
        batch: { include: { channel: true, group: true } },
        enteredBy: { select: { id: true, name: true } },
        events: { where: { kind: { in: ["RECHARGE", "WITHDRAWAL"] } }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ openedOn: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ orders });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
}

export async function POST(request: Request) {
  let sessionUser;
  try { sessionUser = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!hasAnyRole(sessionUser, customerOrderWriteRoles))
    return authorizationDenied(sessionUser, "当前岗位不能登记开单");

  try {
    const rawRows = getRows(await readLimitedJson(request, API_LIMITS.customerOrderBodyBytes));
    if (!rawRows.length) return NextResponse.json({ error: "请至少填写一条开单记录" }, { status: 400 });
    const limitError = rowsLimitError(rawRows.length, API_LIMITS.customerOrderRows, "开单记录");
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });
    const fields: FieldErrors = {};
    const rows = rawRows.map((raw, index): (CustomerOrderInput & { phone: string }) | null => {
      try {
        const parsed = parseCustomerOrderInput(raw);
        return { ...parsed, phone: normalizeCustomerOrderIdentifier(parsed.phone) };
      } catch (error) {
        if (error instanceof ZodError) {
          error.issues.forEach((issue) => { fields[`rows.${index}.${issue.path.join(".")}`] = [issue.message]; });
        } else if (error instanceof Error) {
          fields[`rows.${index}.phone`] = [error.message];
        } else throw error;
        return null;
      }
    });
    const validRows = rows.flatMap((row, index) => row ? [{ row, index }] : []);
    const settings = await getSystemSettings();
    const timezone = await resolveUserBusinessTimezone(sessionUser, settings.timezone);
    const today = statisticsDate();
    validRows.forEach(({ row, index }) => {
      const error = entryDateError(row.openedOn, today, "开单日期");
      if (error) fields[`rows.${index}.openedOn`] = [error];
    });
    const duplicatePhones = new Set<string>();
    const seenPhones = new Set<string>();
    validRows.forEach(({ row }) => {
      if (seenPhones.has(row.phone)) duplicatePhones.add(row.phone);
      seenPhones.add(row.phone);
    });
    validRows.forEach(({ row, index }) => {
      if (duplicatePhones.has(row.phone)) fields[`rows.${index}.phone`] = ["同一次保存中号码不能重复"];
    });
    if (Object.keys(fields).length) return NextResponse.json({ error: "请检查填写内容", fields }, { status: 400 });

    const result = await db.$transaction(async (transaction) => {
      const actor = await transaction.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, active: true, role: true, groupId: true, roleAssignments: { select: { role: true } } } });
      if (!actor || !hasAnyRole(actor, customerOrderWriteRoles)) return { status: 403 as const, error: "当前账号不能录入业务数据" };
      const batches = await transaction.sourceBatch.findMany({
        where: { id: { in: validRows.map(({ row }) => row.batchId) } },
        include: { group: true, channel: true },
      });
      const batchById = new Map(batches.map((batch) => [batch.id, batch]));
      const leadIds = validRows.map(({ row }) => row.leadId);
      const leads = await transaction.leadCustomer.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, phone: true, batchId: true, ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true, currentGroupId: true, invalid: true, groupStatus: true, registeredOn: true, isHistoricalRecord: true },
      });
      const leadById = new Map(leads.map((lead) => [lead.id, lead]));
      for (const { row, index } of validRows) {
        const batch = batchById.get(row.batchId);
        if (!batch) fields[`rows.${index}.batchId`] = ["来源批次不存在"];
        else if (!batch.group.active || !batch.channel.active) fields[`rows.${index}.batchId`] = ["来源批次已停用"];
        const lead = leadById.get(row.leadId);
        const canOpen = Boolean(lead && batch && canWriteCustomerRevenue(actor, { batch, lead }));
        if (!lead || !canOpen) fields[`rows.${index}.leadId`] = ["只能为自己负责的客户开单"];
        else if (lead.groupStatus === "NOT_JOINED" || !lead.registeredOn) fields[`rows.${index}.leadId`] = ["客户进过群并注册后才能开单"];
        else if (row.openedOn < lead.registeredOn) fields[`rows.${index}.openedOn`] = ["开单日期不能早于注册日期"];
        else if (lead.batchId !== row.batchId || lead.phone !== row.phone) fields[`rows.${index}.leadId`] = ["开单号码与客户档案不一致"];
      }
      const existing = await transaction.customerOrder.findMany({ where: { phone: { in: validRows.map(({ row }) => row.phone) } }, select: { id: true, phone: true, voidedAt: true } });
      const existingByPhone = new Map(existing.map((order) => [order.phone, order]));
      validRows.forEach(({ row, index }) => {
        if (existingByPhone.get(row.phone)?.voidedAt === null) fields[`rows.${index}.phone`] = ["该号码已经开过单，后续入金请到财务流水登记续充"];
      });
      if (Object.keys(fields).length) return { status: 400 as const, error: "请检查填写内容" };

      const orders = [];
      for (const { row } of validRows) {
        const previous = existingByPhone.get(row.phone);
        const order = previous?.voidedAt
          ? await transaction.customerOrder.update({ where: { id: previous.id }, data: { ...row, enteredById: actor.id, voidedAt: null, voidReason: null, voidedById: null } })
          : await transaction.customerOrder.create({ data: { ...row, enteredById: actor.id } });
        await transaction.leadCustomer.update({
          where: { id: row.leadId },
          data: { noInitialDepositOn: null, noInitialDepositReason: null, noInitialDepositNote: null, expertWorkflowStage: "ORDERED", expertStageChangedAt: new Date() },
        });
        // 首充写入客户跟踪明细；公司认账金额由组员在每日财务数据中填写。
        await transaction.customerFinanceEvent.create({
          data: {
            batchId: row.batchId,
            customerOrderId: order.id,
            enteredById: actor.id,
            occurredOn: row.openedOn,
            kind: "RECHARGE",
            amountCents: row.initialDepositCents,
            depositMethod: row.initialDepositMethod,
          },
        });
        const lead = leadById.get(row.leadId)!;
        const batch = batchById.get(row.batchId)!;
        await syncCustomerOrderEvent(transaction, {
          ...lead, phone: row.phone,
          batch: { groupId: batch.groupId, channelId: batch.channelId },
        }, { businessDate: row.openedOn });
        orders.push(order);
      }
      return { status: 201 as const, orders };
    });
    if (!result.orders) return result.status === 403
      ? authorizationDenied(sessionUser, result.error)
      : NextResponse.json({ error: result.error, fields }, { status: result.status });
    return NextResponse.json({ saved: result.orders.length, orders: result.orders }, { status: 201 });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "该号码已经开过单，后续入金请登记续充" }, { status: 409 });
    }
    throw error;
  }
}
