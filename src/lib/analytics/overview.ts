import type { Prisma } from "@prisma/client";
import { db } from "../db";
import {
  calculateBatchTotals,
  type BatchTotals,
  type MetricEvent,
} from "../metrics";
import { getLargestDrop, getMaturity } from "./metrics";
import { isWithinMaturityWindow } from "./maturity-window";
import type { AnalysisScope } from "./types";
import { loadCanonicalMetricEvents } from "./canonical-events";
import { businessWorkStatus, resolveGroupBusinessTime } from "../business-time";

export type FunnelDrop = ReturnType<typeof getLargestDrop>;

export type PersonAlert = {
  userId: string;
  name: string;
  reason: string;
  count: number;
};

export type BatchAlert = {
  batchId: string;
  memberId: string;
  normalizedName: string;
  channelName: string;
  memberName: string;
  reason: string;
  count: number;
};

export type CustomerAlert = {
  leadId: string;
  phone: string;
  customerName: string | null;
  ownerName: string;
  reason: string;
  count: number;
};

export type ManagementOverview = {
  hasData: boolean;
  totals: BatchTotals;
  summary: Pick<BatchTotals, "newFans" | "orders" | "rechargeCents"> & {
    orderRate: number | null;
    financialRechargeCents?: number;
    withdrawalCents?: number;
    netPerformanceCents?: number;
    matureNewFans?: number;
    matureOrders?: number;
    matureOrderRate?: number | null;
  };
  trend: Array<{ occurredOn: string; orders: number; rechargeCents: number }>;
  largestDrop: FunnelDrop | null;
  groupComparison?: Array<{
    groupId: string;
    groupName: string;
    departmentId: string;
    departmentName: string;
    countryCode?: string | null;
    orders: number;
    rechargeCents: number;
    withdrawalCents: number;
    netPerformanceCents: number;
    newFans?: number;
    effectiveFans: number;
    replies?: number;
    groupJoin?: number;
    groupLeave?: number;
    abnormalGroupLeave?: number;
    expertIntro?: number;
    expertContacted?: number;
    registration?: number;
    noNumber?: number;
    duplicateFans?: number;
    matureNewFans: number;
    matureOrders: number;
    matureOrderRate: number | null;
    confirmedPeople: number;
    activePeople: number;
    risk: "HIGH" | "MEDIUM" | "LOW";
  }>;
  workforce?: {
    total: number;
    byRole: { reception: number; groupOperator: number; expert: number; lead: number };
  };
  alerts: {
    unconfirmed: PersonAlert[];
    noRecords3Days: PersonAlert[];
    replyWithoutFans: BatchAlert[];
    funnelAnomalies: BatchAlert[];
    excessiveLeaves: BatchAlert[];
    unassignedExperts?: CustomerAlert[];
    registrationOverdue?: CustomerAlert[];
    orderOverdue?: CustomerAlert[];
    planOverdue?: CustomerAlert[];
  };
};

function dashboardFinancials(events: Awaited<ReturnType<typeof loadCanonicalMetricEvents>>) {
  const totals = calculateBatchTotals(events);
  return {
    totals,
    netPerformanceCents: totals.rechargeCents - totals.withdrawalCents,
  };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

const eventValue = (event: MetricEvent) =>
  event.kind === "RECHARGE" ? (event.amountCents ?? 0) : (event.quantity ?? 0);

const anomalyReason = (totals: BatchTotals): string | null => {
  if (totals.groupJoin > totals.newFans) return "入群大于提交号码";
  if (totals.expertIntro > totals.groupJoin) return "推专家大于入群";
  if (totals.registration > totals.expertIntro) return "注册大于推专家";
  if (totals.orders > totals.newFans) return "开单大于提交号码";
  return null;
};

export async function loadManagementOverview(
  scope: AnalysisScope,
  today: string,
  now = new Date(),
): Promise<ManagementOverview> {
  if (scope.requestedForbiddenGroup || scope.groupIds.length === 0) {
    const totals = calculateBatchTotals([]);
    return {
      hasData: false,
      totals,
      summary: {
        newFans: 0,
        orders: 0,
        rechargeCents: 0,
        orderRate: null,
        financialRechargeCents: 0,
        withdrawalCents: 0,
        netPerformanceCents: 0,
        matureNewFans: 0,
        matureOrders: 0,
        matureOrderRate: null,
      },
      trend: Array.from({ length: 7 }, (_, index) => ({
        occurredOn: addDays(today, index - 6),
        orders: 0,
        rechargeCents: 0,
      })),
      largestDrop: null,
      groupComparison: [],
      alerts: {
        unconfirmed: [],
        noRecords3Days: [],
        replyWithoutFans: [],
        funnelAnomalies: [],
        excessiveLeaves: [],
        unassignedExperts: [],
        registrationOverdue: [],
        orderOverdue: [],
        planOverdue: [],
      },
    };
  }

  const peopleWhere = {
    groupId: { in: scope.groupIds },
    // 组长负责检查和推进团队，不是接粉录入人员；录入提醒只针对组员。
    role: "RECEPTION",
    ...(scope.includeInactive ? {} : { active: true }),
    ...(scope.memberId ? { id: scope.memberId } : {}),
  } satisfies Prisma.UserWhereInput;
  const sevenDaysAgo = addDays(today, -6);
  const threeDaysAgo = addDays(today, -2);

  const [events, alertEvents, people, workforcePeople, flowLeads, groupMetadata] = await Promise.all([
    loadCanonicalMetricEvents({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom: scope.sourceDateFrom,
      sourceDateTo: scope.sourceDateTo,
      normalizedName: scope.normalizedName,
      memberId: scope.memberId,
      occurredOnFrom: sevenDaysAgo,
      occurredOnTo: today,
    }),
    loadCanonicalMetricEvents({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom: scope.sourceDateFrom,
      sourceDateTo: scope.sourceDateTo,
      normalizedName: scope.normalizedName,
      memberId: scope.memberId,
      occurredOnTo: today,
    }),
    db.user.findMany({
      where: peopleWhere,
      select: {
        id: true,
        name: true,
        groupId: true,
        confirmations: { where: { businessDate: { in: [addDays(today, -1), today, addDays(today, 1)] } }, select: { id: true, businessDate: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: {
        groupId: { in: scope.groupIds },
        active: true,
        role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT", "LEAD"] },
      },
      select: { role: true },
    }),
    db.leadCustomer.findMany({
      where: {
        invalid: false,
        trackingArchivedAt: null,
        // 客户预警只服务于正常漏斗。历史补录的开单/资金仍由上面的
        // canonical events 进入财务汇总，不能生成待跟进预警。
        isHistoricalRecord: false,
        batch: {
          groupId: { in: scope.groupIds },
          ...(scope.channelIds ? { channelId: { in: scope.channelIds } } : {}),
          isHistoricalRecord: false,
          sourceDate: { gte: scope.sourceDateFrom, lte: scope.sourceDateTo },
          ...(scope.normalizedName ? { channel: { normalizedName: scope.normalizedName } } : {}),
        },
        ...(scope.memberId ? { ownerId: scope.memberId } : {}),
      },
      select: {
        id: true,
        phone: true,
        customerName: true,
        groupStatus: true,
        expertIntroducedOn: true,
        expertContactedOn: true,
        expertOwnerId: true,
        registeredOn: true,
        nextFollowUpOn: true,
        owner: { select: { name: true } },
        customerOrder: { select: { voidedAt: true } },
        batch: { select: { groupId: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.teamGroup.findMany({
      where: { id: { in: scope.groupIds } },
      select: { id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, department: { select: { id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } } },
      orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  const groupBusinessState = new Map(groupMetadata.map((group) => {
    const config = resolveGroupBusinessTime(group);
    return [group.id, businessWorkStatus(config, now)] as const;
  }));
  const isConfirmedForGroupToday = (person: (typeof people)[number]) => {
    const groupToday = person.groupId ? groupBusinessState.get(person.groupId)?.businessDate : today;
    return person.confirmations.some((confirmation) => confirmation.businessDate === groupToday);
  };
  const isPastGroupWorkday = (person: (typeof people)[number]) => person.groupId
    ? groupBusinessState.get(person.groupId)?.status === "AFTER_WORK"
    : true;

  const totals = calculateBatchTotals(events);
  const cohortFinancials = dashboardFinancials(alertEvents);
  const matureEvents = alertEvents.filter((event) =>
    getMaturity(event.batch.sourceDate, today).d7
    && isWithinMaturityWindow(event.batch.sourceDate, event.occurredOn, 7),
  );
  const matureTotals = calculateBatchTotals(matureEvents);
  const ownersWithRecentRecords = new Set(
    alertEvents
      .filter((event) => event.occurredOn >= threeDaysAgo)
      .map((event) => event.enteredById),
  );
  const trendMap = new Map<string, { orders: number; rechargeCents: number }>();
  for (const event of events) {
    const point = trendMap.get(event.occurredOn) ?? {
      orders: 0,
      rechargeCents: 0,
    };
    if (event.kind === "ORDER") point.orders += eventValue(event);
    if (event.kind === "RECHARGE") point.rechargeCents += eventValue(event);
    trendMap.set(event.occurredOn, point);
  }

  const activeOwnerBatches = new Set(
    alertEvents
      .filter((event) => event.occurredOn === today)
      .map((event) => `${event.batchId}:${event.enteredById}`),
  );
  const byOwnerBatch = new Map<
    string,
    { events: MetricEvent[]; alert: Omit<BatchAlert, "reason" | "count"> }
  >();
  for (const event of alertEvents) {
    const key = `${event.batchId}:${event.enteredById}`;
    if (!activeOwnerBatches.has(key)) continue;
    const current = byOwnerBatch.get(key) ?? {
      events: [],
      alert: {
        batchId: event.batchId,
        memberId: event.enteredById,
        normalizedName: event.batch.channel.normalizedName,
        channelName: event.batch.channel.name,
        memberName: event.enteredBy.name,
      },
    };
    current.events.push(event);
    byOwnerBatch.set(key, current);
  }

  const replyWithoutFans: BatchAlert[] = [];
  const funnelAnomalies: BatchAlert[] = [];
  const excessiveLeaves: BatchAlert[] = [];
  for (const { events: batchEvents, alert } of byOwnerBatch.values()) {
    const batchTotals = calculateBatchTotals(batchEvents);
    if (batchTotals.replies > 0 && batchTotals.newFans === 0)
      replyWithoutFans.push({
        ...alert,
        reason: "有回复但没有提交号码",
        count: batchTotals.replies,
      });
    const reason = anomalyReason(batchTotals);
    if (reason) funnelAnomalies.push({ ...alert, reason, count: 1 });
    if (batchTotals.groupLeave > batchTotals.groupJoin)
      excessiveLeaves.push({
        ...alert,
        reason: "退群大于入群",
        count: batchTotals.groupLeave - batchTotals.groupJoin,
      });
  }

  const timeoutCutoff = addDays(today, -3);
  const customerAlert = (lead: (typeof flowLeads)[number], reason: string): CustomerAlert => ({
    leadId: lead.id,
    phone: lead.phone,
    customerName: lead.customerName,
    ownerName: lead.owner.name,
    reason,
    count: 1,
  });
  const unassignedExperts = flowLeads
    .filter((lead) => lead.groupStatus === "JOINED" && lead.expertIntroducedOn && !lead.expertOwnerId)
    .map((lead) => customerAlert(lead, "已推专家但尚未分配负责人"));
  const registrationOverdue = flowLeads
    .filter((lead) => lead.groupStatus === "JOINED" && lead.expertOwnerId && lead.expertIntroducedOn && lead.expertIntroducedOn <= timeoutCutoff && !lead.registeredOn)
    .map((lead) => customerAlert(lead, "推专家满 3 天仍未注册"));
  const orderOverdue = flowLeads
    .filter((lead) => lead.groupStatus === "JOINED" && lead.registeredOn && lead.registeredOn <= timeoutCutoff && (!lead.customerOrder || lead.customerOrder.voidedAt))
    .map((lead) => customerAlert(lead, "注册满 3 天仍未开单"));
  const planOverdue = flowLeads
    .filter((lead) => lead.groupStatus !== "LEFT" && lead.nextFollowUpOn && lead.nextFollowUpOn < today)
    .map((lead) => customerAlert(lead, "下一步计划已逾期"));

  const groupComparison = groupMetadata.map((group) => {
    const groupEvents = alertEvents.filter((event) => event.batch.group.id === group.id);
    const groupFinancials = dashboardFinancials(groupEvents);
    const groupMatureTotals = calculateBatchTotals(groupEvents.filter((event) =>
      getMaturity(event.batch.sourceDate, today).d7
      && isWithinMaturityWindow(event.batch.sourceDate, event.occurredOn, 7),
    ));
    const groupPeople = people.filter((person) => person.groupId === group.id);
    const groupLeads = flowLeads.filter((lead) => lead.batch.groupId === group.id);
    const matureOrderRate = groupMatureTotals.newFans === 0
      ? null
      : groupMatureTotals.orders / groupMatureTotals.newFans;
    const netPerformanceCents = groupFinancials.totals.rechargeCents - groupFinancials.totals.withdrawalCents;
    const risk = netPerformanceCents < 0
      ? "HIGH" as const
      : matureOrderRate !== null && matureOrderRate < 0.08
        ? "MEDIUM" as const
        : "LOW" as const;
    return {
      groupId: group.id,
      groupName: group.name,
      departmentId: group.department.id,
      departmentName: group.department.name,
      countryCode: group.countryCode || group.department.countryCode || null,
      orders: groupFinancials.totals.orders,
      rechargeCents: groupFinancials.totals.rechargeCents,
      withdrawalCents: groupFinancials.totals.withdrawalCents,
      netPerformanceCents,
      newFans: groupFinancials.totals.newFans,
      effectiveFans: groupFinancials.totals.effectiveFans,
      replies: groupFinancials.totals.replies,
      groupJoin: groupFinancials.totals.groupJoin,
      groupLeave: groupFinancials.totals.groupLeave,
      abnormalGroupLeave: groupFinancials.totals.abnormalGroupLeave ?? 0,
      expertIntro: groupFinancials.totals.expertIntro,
      expertContacted: groupLeads.filter((lead) => Boolean(lead.expertContactedOn)).length,
      registration: groupFinancials.totals.registration,
      noNumber: groupFinancials.totals.noNumber,
      duplicateFans: groupFinancials.totals.duplicateFans,
      matureNewFans: groupMatureTotals.newFans,
      matureOrders: groupMatureTotals.orders,
      matureOrderRate,
      confirmedPeople: groupPeople.filter(isConfirmedForGroupToday).length,
      activePeople: groupPeople.length,
      risk,
    };
  }).sort((left, right) => right.netPerformanceCents - left.netPerformanceCents);

  return {
    hasData: events.length > 0,
    totals,
    summary: {
      newFans: totals.newFans,
      orders: totals.orders,
      rechargeCents: totals.rechargeCents,
      orderRate: totals.newFans === 0 ? null : totals.orders / totals.newFans,
      financialRechargeCents: cohortFinancials.totals.rechargeCents,
      withdrawalCents: cohortFinancials.totals.withdrawalCents,
      netPerformanceCents: cohortFinancials.netPerformanceCents,
      matureNewFans: matureTotals.newFans,
      matureOrders: matureTotals.orders,
      matureOrderRate: matureTotals.newFans === 0 ? null : matureTotals.orders / matureTotals.newFans,
    },
    trend: Array.from({ length: 7 }, (_, index) => {
      const occurredOn = addDays(today, index - 6);
      return {
        occurredOn,
        ...(trendMap.get(occurredOn) ?? { orders: 0, rechargeCents: 0 }),
      };
    }),
    largestDrop: events.length === 0 ? null : getLargestDrop(totals),
    groupComparison,
    workforce: {
      total: workforcePeople.length,
      byRole: {
        reception: workforcePeople.filter((person) => person.role === "RECEPTION").length,
        groupOperator: workforcePeople.filter((person) => person.role === "GROUP_OPERATOR").length,
        expert: workforcePeople.filter((person) => person.role === "EXPERT").length,
        lead: workforcePeople.filter((person) => person.role === "LEAD").length,
      },
    },
    alerts: {
      unconfirmed: people
        .filter((person) => isPastGroupWorkday(person) && !isConfirmedForGroupToday(person))
        .map((person) => ({
          userId: person.id,
          name: person.name,
          reason: "今日尚未确认数据",
          count: 1,
        })),
      noRecords3Days: people
        .filter((person) => !ownersWithRecentRecords.has(person.id))
        .map((person) => ({
          userId: person.id,
          name: person.name,
          reason: "连续 3 天没有录入记录",
          count: 3,
        })),
      replyWithoutFans,
      funnelAnomalies,
      excessiveLeaves,
      unassignedExperts,
      registrationOverdue,
      orderOverdue,
      planOverdue,
    },
  };
}
