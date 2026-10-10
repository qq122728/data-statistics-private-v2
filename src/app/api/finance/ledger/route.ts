import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    return NextResponse.json({ error: error instanceof AuthenticationError ? "请先登录" : "无法确认账号" }, { status: 401 });
  }
  if (actor.role !== "FINANCE" && !hasAssignedRole(actor, "FINANCE")) {
    return authorizationDenied(actor, "只有财务账号可以查看客户资金登记");
  }
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const groupId = params.get("groupId") ?? "";
  const groupIds = (params.get("groupIds") ?? "").split(",").filter(Boolean);
  const channelId = params.get("channelId") ?? "";
  if (!dateOnly.test(from) || !dateOnly.test(to) || from > to) {
    return NextResponse.json({ error: "请选择正确的资金日期范围" }, { status: 400 });
  }
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 31) return NextResponse.json({ error: "资金明细一次最多查看31天" }, { status: 400 });
  const batchWhere = {
    ...((groupId || groupIds.length) ? { groupId: { in: groupId ? [groupId] : [...new Set(groupIds)] } } : {}),
    ...(channelId ? { channelId } : {}),
    group: { active: true },
  };
  const commonSelect = {
    batch: {
      select: {
        groupId: true,
        group: { select: { name: true, department: { select: { name: true, company: { select: { name: true } } } } } },
        channel: { select: { id: true, name: true } },
      },
    },
    enteredBy: { select: { id: true, name: true } },
    customerOrder: {
      select: {
        phone: true,
        lead: { select: { owner: { select: { id: true, name: true } }, attributionOwner: { select: { id: true, name: true } } } },
      },
    },
  } as const;
  const [orders, events] = await Promise.all([
    db.customerOrder.findMany({
      where: { openedOn: { gte: from, lte: to }, voidedAt: null, initialDepositCents: { gt: 0 }, batch: batchWhere },
      select: {
        id: true, phone: true, openedOn: true, initialDepositCents: true, initialDepositMethod: true,
        enteredBy: { select: { id: true, name: true } },
        batch: commonSelect.batch,
        lead: { select: { owner: { select: { id: true, name: true } }, attributionOwner: { select: { id: true, name: true } } } },
      },
      orderBy: [{ openedOn: "desc" }, { createdAt: "desc" }],
    }),
    db.customerFinanceEvent.findMany({
      where: { occurredOn: { gte: from, lte: to }, voidedAt: null, customerOrder: { voidedAt: null }, batch: batchWhere },
      select: { id: true, occurredOn: true, kind: true, amountCents: true, depositMethod: true, ...commonSelect },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const describe = (batch: (typeof orders)[number]["batch"], owner: { id: string; name: string } | null | undefined, enteredBy: { id: string; name: string }) => ({
    groupId: batch.groupId,
    groupName: batch.group.name,
    departmentName: batch.group.department.name,
    companyName: batch.group.department.company?.name ?? "未归属公司",
    channel: batch.channel,
    owner: owner ?? enteredBy,
    enteredBy,
  });
  const rows = [
    ...orders.map((order) => ({
      id: `initial:${order.id}`, date: order.openedOn, kind: "INITIAL" as const, phone: order.phone,
      amountCents: order.initialDepositCents, depositMethod: order.initialDepositMethod,
      ...describe(order.batch, order.lead?.attributionOwner ?? order.lead?.owner, order.enteredBy),
    })),
    ...events.map((event) => ({
      id: event.id, date: event.occurredOn, kind: event.kind, phone: event.customerOrder.phone,
      amountCents: event.amountCents, depositMethod: event.depositMethod,
      ...describe(event.batch, event.customerOrder.lead?.attributionOwner ?? event.customerOrder.lead?.owner, event.enteredBy),
    })),
  ].sort((left, right) => right.date.localeCompare(left.date) || left.phone.localeCompare(right.phone));
  return NextResponse.json({ from, to, rows }, { headers: { "Cache-Control": "private, no-store" } });
}
