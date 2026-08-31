import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { hasAssignedRole, isFrontlineGroupMember } from "../../../../lib/role-access";
import { API_LIMITS, hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { canViewOrgScope } from "../../../../lib/org-permissions";
import { resolveExpertWorkflowStage, type ExpertWorkflowStage } from "../../../../lib/expert-workflow-stage";
import { customerCurrentGroupWhere } from "../../../../lib/customer-current-group";

const stages = new Set(["reception", "group", "expert"]);
const expertStages = ["QUEUED", "MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED", "STALLED"] as const;
const PAGE_SIZE = 50;

function stageWhere(stage: string): Prisma.LeadCustomerWhereInput {
  if (stage === "reception") return { groupStatus: "NOT_JOINED", receptionArchivedAt: null };
  if (stage === "expert") return { expertIntroducedOn: { not: null } };
  return { groupStatus: { in: ["JOINED", "LEFT"] } };
}

/** 新版组长客户进度的只读入口。写操作继续走各岗位已有的专用 workflow API。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  if (!actor.active) return authorizationDenied(actor, "当前账号已停用");
  const isLead = Boolean(actor.groupId) && hasAssignedRole(actor, "LEAD");
  const requestedGroupId = (params.get("groupId") ?? "").trim();
  const isOwnGroupMember = Boolean(actor.groupId)
    && isFrontlineGroupMember(actor)
    && (!requestedGroupId || requestedGroupId === actor.groupId);
  const targetGroupId = isLead || isOwnGroupMember ? actor.groupId! : requestedGroupId;
  if (!targetGroupId) return NextResponse.json({ error: "请先选择一个具体小组" }, { status: 400 });
  const group = await db.teamGroup.findFirst({
    where: { id: targetGroupId, active: true },
    select: {
      id: true, departmentId: true, countryCode: true, timezone: true,
      workStartMinutes: true, workEndMinutes: true,
      department: { select: { companyId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
  });
  if (!group || (!isLead && !isOwnGroupMember && !canViewOrgScope(actor, { level: "group", groupId: group.id, departmentId: group.departmentId, companyId: group.department.companyId })))
    return authorizationDenied(actor, "没有权限查看这个小组的客户进度");

  const stage = stages.has(params.get("stage") ?? "") ? params.get("stage")! : "reception";
  const pageValue = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = (params.get("q") ?? "").trim().slice(0, API_LIMITS.searchCharacters);
  const channel = (params.get("channel") ?? "").trim().slice(0, API_LIMITS.searchCharacters);
  const timezone = resolveGroupBusinessTime(group).timezone;
  const today = localDateYYYYMMDD(new Date(), timezone);
  const baseWhere: Prisma.LeadCustomerWhereInput = {
    AND: [customerCurrentGroupWhere(group.id)],
    invalid: false,
    ...(query ? { OR: [{ phone: { contains: query } }, { customerName: { contains: query } }] } : {}),
  };
  const filteredBaseWhere: Prisma.LeadCustomerWhereInput = channel
    ? { AND: [baseWhere, { batch: { channel: { name: channel } } }] }
    : baseWhere;
  const expertStageParam = params.get("expertStage");
  const expertStage = expertStages.includes(expertStageParam as ExpertWorkflowStage) ? expertStageParam as ExpertWorkflowStage : "all";
  const expertCandidates = stage === "expert" ? await db.leadCustomer.findMany({
    where: { AND: [filteredBaseWhere, stageWhere("expert")] },
    select: {
      id: true, expertWorkflowStage: true, expertIntroducedOn: true, expertContactedOn: true,
      expertTrackingStartedAt: true, registeredOn: true, noInitialDepositOn: true, expertStalledOn: true,
      updatedAt: true, customerOrder: { select: { voidedAt: true } },
    },
  }) : [];
  const resolvedExpertCandidates = expertCandidates.map((customer) => ({
    id: customer.id,
    updatedAt: customer.updatedAt,
    stage: resolveExpertWorkflowStage({
      ...customer,
      hasActiveOrder: Boolean(customer.customerOrder && !customer.customerOrder.voidedAt),
    })!,
  })).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id));
  const expertCounts = Object.fromEntries(expertStages.map((value) => [value, resolvedExpertCandidates.filter((customer) => customer.stage === value).length]));
  const matchedExpertCandidates = expertStage === "all"
    ? resolvedExpertCandidates
    : resolvedExpertCandidates.filter((customer) => customer.stage === expertStage);
  const expertPageIds = matchedExpertCandidates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((customer) => customer.id);
  const expertStageById = new Map(resolvedExpertCandidates.map((customer) => [customer.id, customer.stage]));
  const where: Prisma.LeadCustomerWhereInput = stage === "expert"
    ? { id: { in: expertPageIds } }
    : { AND: [filteredBaseWhere, stageWhere(stage)] };
  const summaryWhere: Prisma.LeadCustomerWhereInput = stage === "expert"
    ? { id: { in: matchedExpertCandidates.map((customer) => customer.id) } }
    : where;
  const unfilteredStageWhere: Prisma.LeadCustomerWhereInput = { AND: [baseWhere, stageWhere(stage)] };
  const activeOrderWhere: Prisma.CustomerOrderWhereInput = { voidedAt: null, lead: summaryWhere };
  const countStages = ["reception", "group", "expert"] as const;
  const [total, customerRows, channelRows, orderCount, initialDeposit, recharge, withdrawal, ...counts] = await Promise.all([
    stage === "expert" ? Promise.resolve(matchedExpertCandidates.length) : db.leadCustomer.count({ where }),
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, phone: true, customerName: true, customerEmail: true,
        lossAmountCents: true, customerPlatform: true, notes: true,
        replyStatus: true, repliedOn: true, followUpCount: true, lastFollowedUpOn: true,
        groupStatus: true, joinedOn: true, leftOn: true, leftNote: true, leftWithOrder: true,
        expertIntroducedOn: true, expertContactedOn: true, expertContactNote: true,
        expertWorkflowStage: true, expertTrackingStartedAt: true, registeredOn: true, expertNotes: true, nextPlan: true, nextFollowUpOn: true,
        noInitialDepositOn: true, noInitialDepositReason: true, noInitialDepositNote: true,
        expertStalledOn: true, expertStalledReason: true, expertStalledNote: true,
        owner: { select: { id: true, name: true } },
        device: { select: { id: true, code: true } },
        groupOperatorOwner: { select: { id: true, name: true } },
        expertOwner: { select: { id: true, name: true } },
        batch: { select: { id: true, sourceDate: true, channel: { select: { name: true } }, group: { select: { name: true } } } },
        customerOrder: {
          select: {
            id: true, openedOn: true, initialDepositCents: true, voidedAt: true,
            events: {
              where: { voidedAt: null, kind: { in: ["RECHARGE", "WITHDRAWAL"] } },
              select: { id: true, kind: true, amountCents: true, occurredOn: true, continuationNumber: true },
              orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
            },
          },
        },
        activities: {
          where: { kind: { in: ["REPLIED", "JOINED_GROUP", "LEFT_GROUP", "GROUP_PROGRESS_UPDATED", "EXPERT_INTRODUCED", "EXPERT_CONTACTED", "REGISTERED", "PLAN_UPDATED"] } },
          select: { id: true, kind: true, occurredOn: true, note: true, actor: { select: { name: true } } },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
          take: 3,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: stage === "expert" ? undefined : (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.leadCustomer.findMany({
      where: unfilteredStageWhere,
      select: { batch: { select: { channel: { select: { name: true } } } } },
      distinct: ["batchId"],
    }),
    db.customerOrder.count({ where: activeOrderWhere }),
    db.customerOrder.aggregate({ where: activeOrderWhere, _sum: { initialDepositCents: true } }),
    db.customerFinanceEvent.aggregate({
      where: { voidedAt: null, kind: "RECHARGE", continuationNumber: { not: null }, customerOrder: activeOrderWhere },
      _sum: { amountCents: true },
    }),
    db.customerFinanceEvent.aggregate({
      where: { voidedAt: null, kind: "WITHDRAWAL", customerOrder: activeOrderWhere },
      _sum: { amountCents: true },
    }),
    ...countStages.map((value) => db.leadCustomer.count({ where: { AND: [filteredBaseWhere, stageWhere(value)] } })),
  ]);
  const customerById = new Map(customerRows.map((customer) => [customer.id, customer]));
  const customers = stage === "expert"
    ? expertPageIds.map((id) => customerById.get(id)).filter((customer): customer is NonNullable<typeof customer> => Boolean(customer))
    : customerRows;

  return NextResponse.json({
    stage, expertStage, expertCounts, page, pageSize: PAGE_SIZE, total, today, timezone,
    channels: [...new Set(channelRows.map((row) => row.batch.channel.name))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    summary: {
      customerCount: total,
      orderCount,
      initialDepositCents: initialDeposit._sum.initialDepositCents ?? 0,
      rechargeCents: recharge._sum.amountCents ?? 0,
      withdrawalCents: withdrawal._sum.amountCents ?? 0,
    },
    counts: Object.fromEntries(countStages.map((value, index) => [value, counts[index]])),
    customers: customers.map((customer) => {
      const activeOrder = customer.customerOrder && !customer.customerOrder.voidedAt ? customer.customerOrder : null;
      const continuations = activeOrder?.events.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null) ?? [];
      return {
        ...customer,
        expertWorkflowStage: expertStageById.get(customer.id) ?? customer.expertWorkflowStage,
        order: activeOrder ? {
          id: activeOrder.id,
          openedOn: activeOrder.openedOn,
          initialDepositCents: activeOrder.initialDepositCents,
          rechargeCents: continuations.reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
          withdrawalCents: activeOrder.events.filter((event) => event.kind === "WITHDRAWAL").reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
          nextContinuationNumber: Math.max(0, ...continuations.map((event) => event.continuationNumber ?? 0)) + 1,
          financeEvents: activeOrder.events.filter((event) => event.kind === "WITHDRAWAL" || event.continuationNumber !== null),
        } : null,
        customerOrder: undefined,
      };
    }),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
