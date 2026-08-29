import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { resolveGroupOperatorId } from "../../../../lib/group-operator-attribution";
import { API_LIMITS, hasOversizedQueryValue } from "../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

const stages = ["active", "introduced", "left"] as const;
type Stage = (typeof stages)[number];
const PAGE_SIZE = 50;

type Candidate = {
  id: string;
  ownerId: string;
  groupOperatorOwnerId: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  expertIntroducedOn: string | null;
  updatedAt: Date;
  activities: Array<{ actorId: string; occurredOn: string; kind: "EXPERT_INTRODUCED" }>;
};

function groupStage(customer: Pick<Candidate, "groupStatus" | "expertIntroducedOn">): Stage {
  if (customer.groupStatus === "LEFT") return "left";
  return customer.expertIntroducedOn ? "introduced" : "active";
}

function approvedCustomerWhere(): Prisma.LeadCustomerWhereInput {
  return {
    OR: [
      { isHistoricalRecord: false, batch: { isHistoricalRecord: false } },
      { historicalReviewStatus: "APPROVED" },
    ],
  };
}

/** 新版炒群本人工作台。归属统一按：明确指派 → 最近推专家人 → 当前接粉配对。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "GROUP_OPERATOR"))
    return authorizationDenied(actor, "只有在职炒群可以查看自己的客户");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const stageParam = params.get("stage");
  const stage: Stage = stages.includes(stageParam as Stage) ? stageParam as Stage : "active";
  const pageValue = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = (params.get("q") ?? "").trim().slice(0, API_LIMITS.searchCharacters);

  const baseWhere: Prisma.LeadCustomerWhereInput = {
    batch: { groupId: actor.groupId },
    invalid: false,
    receptionCategory: { notIn: ["INVALID", "LOW_AMOUNT", "NO_WS"] },
    groupStatus: { in: ["JOINED", "LEFT"] },
    AND: [
      approvedCustomerWhere(),
      ...(query ? [{ OR: [{ phone: { contains: query } }, { customerName: { contains: query } }] }] : []),
    ],
  };

  const [candidates, pairings, expertAssignees] = await Promise.all([
    db.leadCustomer.findMany({
      where: baseWhere,
      select: {
        id: true,
        ownerId: true,
        groupOperatorOwnerId: true,
        groupStatus: true,
        expertIntroducedOn: true,
        updatedAt: true,
        activities: {
          where: { kind: "EXPERT_INTRODUCED" },
          select: { actorId: true, occurredOn: true, kind: true },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        },
      },
    }),
    db.groupOperatorReception.findMany({
      where: { groupOperator: { groupId: actor.groupId } },
      select: { receptionistId: true, groupOperatorId: true },
    }),
    db.user.findMany({
      where: {
        groupId: actor.groupId,
        active: true,
        OR: [
          { role: { in: ["LEAD", "EXPERT"] } },
          { roleAssignments: { some: { role: "EXPERT" } } },
        ],
      },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
  ]);
  const currentOperatorByReception = new Map(pairings.map((item) => [item.receptionistId, item.groupOperatorId]));
  const owned = (candidates as Candidate[])
    .filter((customer) => resolveGroupOperatorId(customer, currentOperatorByReception, "9999-12-31") === actor.id)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(stages.map((value) => [value, owned.filter((customer) => groupStage(customer) === value).length]));
  const matched = owned.filter((customer) => groupStage(customer) === stage);
  const pageIds = matched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((customer) => customer.id);

  const rows = pageIds.length ? await db.leadCustomer.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true, phone: true, customerName: true, customerEmail: true, lossAmountCents: true, customerPlatform: true,
      notes: true, ownerId: true, groupOperatorOwnerId: true, groupStatus: true, repliedOn: true, joinedOn: true,
      leftOn: true, leftNote: true, leftWithOrder: true, expertIntroducedOn: true, expertContactedOn: true,
      registeredOn: true, expertWorkflowStage: true, nextPlan: true, nextFollowUpOn: true,
      groupDeviceAccountId: true, groupDeviceAccountNumber: true, expertDeviceAccountId: true, expertDeviceAccountNumber: true,
      isHistoricalRecord: true, historicalSourceName: true,
      owner: { select: { id: true, name: true } },
      attributionOwner: { select: { id: true, name: true } },
      expertOwner: { select: { id: true, name: true } },
      device: { select: { id: true, code: true } },
      batch: { select: { id: true, sourceDate: true, isHistoricalRecord: true, channel: { select: { id: true, name: true } } } },
      activities: {
        where: { kind: { in: ["JOINED_GROUP", "LEFT_GROUP", "GROUP_PROGRESS_UPDATED", "EXPERT_INTRODUCED", "EXPERT_CONTACTED", "REGISTERED", "PLAN_UPDATED", "ORDER_VOIDED", "FINANCE_VOIDED"] } },
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
  const byId = new Map(rows.map((row) => [row.id, row]));
  const customers = pageIds.flatMap((id) => {
    const customer = byId.get(id);
    if (!customer) return [];
    const order = customer.customerOrder && !customer.customerOrder.voidedAt ? customer.customerOrder : null;
    const recharges = order?.events.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null) ?? [];
    const withdrawals = order?.events.filter((event) => event.kind === "WITHDRAWAL") ?? [];
    return [{
      ...customer,
      stage: groupStage(customer),
      isHistoricalRecord: customer.isHistoricalRecord || customer.batch.isHistoricalRecord,
      sourceName: customer.historicalSourceName?.trim() || customer.batch.channel.name,
      order: order ? {
        id: order.id,
        openedOn: order.openedOn,
        initialDepositCents: order.initialDepositCents,
        initialDepositMethod: order.initialDepositMethod,
        rechargeCents: recharges.reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
        withdrawalCents: withdrawals.reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
        nextContinuationNumber: Math.max(0, ...recharges.map((event) => event.continuationNumber ?? 0)) + 1,
        events: order.events,
      } : null,
      customerOrder: undefined,
    }];
  });

  return NextResponse.json({ stage, page, pageSize: PAGE_SIZE, total: matched.length, counts, expertAssignees, customers }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
