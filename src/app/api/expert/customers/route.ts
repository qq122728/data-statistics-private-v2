import type { ExpertWorkflowStage, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { resolveExpertWorkflowStage } from "../../../../lib/expert-workflow-stage";
import { API_LIMITS, hasOversizedQueryValue } from "../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

const stages = ["QUEUED", "MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED", "STALLED"] as const;
const PAGE_SIZE = 50;

function approvedCustomerWhere(): Prisma.LeadCustomerWhereInput {
  return {
    OR: [
      { isHistoricalRecord: false, batch: { isHistoricalRecord: false } },
      { historicalReviewStatus: "APPROVED" },
    ],
  };
}

/** 新版专家本人工作台。只返回明确分配给当前专家、且仍属于当前小组的客户。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "EXPERT"))
    return authorizationDenied(actor, "只有在职专家可以查看自己的客户");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const stageParam = params.get("stage");
  const stage = stages.includes(stageParam as ExpertWorkflowStage) ? stageParam as ExpertWorkflowStage : null;
  const pageValue = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = (params.get("q") ?? "").trim().slice(0, API_LIMITS.searchCharacters);
  const baseWhere: Prisma.LeadCustomerWhereInput = {
    batch: { groupId: actor.groupId },
    expertOwnerId: actor.id,
    expertIntroducedOn: { not: null },
    invalid: false,
    receptionCategory: { notIn: ["INVALID", "LOW_AMOUNT", "NO_WS"] },
    AND: [
      approvedCustomerWhere(),
      ...(query ? [{ OR: [{ phone: { contains: query } }, { customerName: { contains: query } }] }] : []),
    ],
  };
  const candidates = await db.leadCustomer.findMany({
    where: baseWhere,
    select: {
      id: true, expertWorkflowStage: true, expertIntroducedOn: true, expertContactedOn: true,
      expertTrackingStartedAt: true, registeredOn: true, noInitialDepositOn: true, expertStalledOn: true,
      updatedAt: true, customerOrder: { select: { voidedAt: true } },
    },
  });
  const resolved = candidates.map((customer) => ({
    id: customer.id,
    updatedAt: customer.updatedAt,
    stage: resolveExpertWorkflowStage({
      ...customer,
      hasActiveOrder: Boolean(customer.customerOrder && !customer.customerOrder.voidedAt),
    })!,
  })).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(stages.map((value) => [value, resolved.filter((customer) => customer.stage === value).length]));
  const matched = stage ? resolved.filter((customer) => customer.stage === stage) : resolved;
  const pageIds = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((customer) => customer.id);

  const rows = pageIds.length ? await db.leadCustomer.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true, phone: true, customerName: true, customerEmail: true, lossAmountCents: true, customerPlatform: true,
      notes: true, groupStatus: true, repliedOn: true, joinedOn: true, leftOn: true, leftNote: true,
      expertIntroducedOn: true, expertContactedOn: true, expertContactNote: true, expertNotes: true,
      expertWorkflowStage: true, expertStageChangedAt: true, expertTrackingStartedAt: true,
      expertStalledOn: true, expertStalledReason: true, expertStalledNote: true,
      noInitialDepositOn: true, noInitialDepositReason: true, noInitialDepositNote: true,
      registeredOn: true, nextPlan: true, nextFollowUpOn: true,
      groupDeviceAccountId: true, groupDeviceAccountNumber: true, expertDeviceAccountId: true, expertDeviceAccountNumber: true,
      isHistoricalRecord: true, historicalSourceName: true,
      owner: { select: { id: true, name: true } },
      attributionOwner: { select: { id: true, name: true } },
      groupOperatorOwner: { select: { id: true, name: true } },
      expertOwner: { select: { id: true, name: true } },
      device: { select: { id: true, code: true } },
      batch: { select: { id: true, sourceDate: true, isHistoricalRecord: true, channel: { select: { id: true, name: true } } } },
      activities: {
        where: { kind: { in: ["GROUP_PROGRESS_UPDATED", "EXPERT_INTRODUCED", "EXPERT_CONTACTED", "REGISTERED", "PLAN_UPDATED", "ORDER_VOIDED", "FINANCE_VOIDED"] } },
        select: { id: true, kind: true, occurredOn: true, note: true, actor: { select: { id: true, name: true } } },
        orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        take: 10,
      },
      customerOrder: {
        select: {
          id: true, openedOn: true, initialDepositCents: true, initialDepositMethod: true, voidedAt: true,
          events: {
            where: { voidedAt: null, OR: [{ kind: "WITHDRAWAL" }, { kind: "RECHARGE", continuationNumber: { not: null } }] },
            select: { id: true, kind: true, amountCents: true, occurredOn: true, continuationNumber: true, depositMethod: true },
            orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
          },
        },
      },
    },
  }) : [];
  const stageById = new Map(resolved.map((customer) => [customer.id, customer.stage]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const customers = pageIds.flatMap((id) => {
    const customer = byId.get(id);
    if (!customer) return [];
    const order = customer.customerOrder && !customer.customerOrder.voidedAt ? customer.customerOrder : null;
    const recharges = order?.events.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null) ?? [];
    const withdrawals = order?.events.filter((event) => event.kind === "WITHDRAWAL") ?? [];
    const rechargeCents = recharges.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    const withdrawalCents = withdrawals.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    return [{
      ...customer,
      stage: stageById.get(id),
      isHistoricalRecord: customer.isHistoricalRecord || customer.batch.isHistoricalRecord,
      sourceName: customer.historicalSourceName?.trim() || customer.batch.channel.name,
      order: order ? {
        id: order.id,
        openedOn: order.openedOn,
        initialDepositCents: order.initialDepositCents,
        initialDepositMethod: order.initialDepositMethod,
        rechargeCents,
        withdrawalCents,
        netDepositCents: order.initialDepositCents + rechargeCents - withdrawalCents,
        nextContinuationNumber: Math.max(0, ...recharges.map((event) => event.continuationNumber ?? 0)) + 1,
        events: order.events,
      } : null,
      customerOrder: undefined,
    }];
  });

  return NextResponse.json({ stage: stage ?? "all", page, pageSize: PAGE_SIZE, total: matched.length, counts, customers }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
