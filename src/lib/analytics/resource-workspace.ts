import { db } from "../db";
import { calculateBatchTotals, emptyBatchTotals, type BatchTotals } from "../metrics";
import { loadCanonicalMetricEvents, type CanonicalMetricEvent } from "./canonical-events";
import { getMaturity } from "./metrics";
import { isWithinMaturityWindow } from "./maturity-window";
import type { AnalysisScope } from "./types";
import { getApprovedInvalidFanTotals, type ApprovedInvalidFanReportTotal } from "../invalid-fan-reports";

export type ResourceRate = { eligible: number; completed: number; rate: number | null };

export type ResourceWorkspace = {
  quality: {
    submitted: number;
    effective: number;
    replies: number;
    duplicate: number;
    invalid: number;
    lowAmount: number;
    noWs: number;
    effectiveRate: number | null;
    customerReplyRate: number | null;
    duplicateRate: number | null;
    invalidRate: number | null;
    matureSample: number;
    matureOrders: number;
    matureOrderRate: number | null;
  };
  execution: {
    receptionReply: ResourceRate;
    receptionJoin: ResourceRate;
    operatorExpert: ResourceRate;
    expertOrder: ResourceRate;
  };
  groups: ResourceGroupRow[];
  daily: ResourceDailyRow[];
};

export type ResourceGroupRow = {
  groupId: string;
  groupName: string;
  submitted: number;
  effectiveRate: number | null;
  customerReplyRate: number | null;
  receptionJoinRate: number | null;
  operatorExpertRate: number | null;
  matureOrderRate: number | null;
  netPerformanceCents: number;
  status: "NORMAL" | "WARNING" | "DANGER" | "INSUFFICIENT";
};

export type ResourceDailyRow = {
  key: string;
  date: string;
  groupId: string;
  groupName: string;
  submitted: number;
  effective: number;
  replies: number;
  joined: number;
  introduced: number;
  registered: number;
  orders: number;
  mature: boolean;
};

type ImportFact = {
  kind: "NEW_FANS" | "EFFECTIVE_FANS" | "NO_NUMBER" | "DUPLICATE_FANS";
  quantity: number | null;
  occurredOn: string;
  batch: {
    sourceDate: string;
    group: { id: string; name: string };
  };
};

const ratio = (value: number, base: number) => base === 0 ? null : value / base;

function addDays(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function importTotals(events: ImportFact[]) {
  const result = { submitted: 0, effective: 0, duplicate: 0, invalid: 0 };
  for (const event of events) {
    const quantity = event.quantity ?? 0;
    if (event.kind === "NEW_FANS") result.submitted += quantity;
    if (event.kind === "EFFECTIVE_FANS") result.effective += quantity;
    if (event.kind === "DUPLICATE_FANS") result.duplicate += quantity;
    if (event.kind === "NO_NUMBER") result.invalid += quantity;
  }
  return result;
}

function rate(eligible: number, completed: number): ResourceRate {
  return { eligible, completed, rate: ratio(completed, eligible) };
}

function groupKey(date: string, groupId: string) {
  return `${date}\0${groupId}`;
}

export async function loadResourceWorkspace(scope: AnalysisScope, today: string, dailyMode: "source" | "activity"): Promise<ResourceWorkspace> {
  if (scope.requestedForbiddenGroup || !scope.groupIds.length) return {
    quality: { submitted: 0, effective: 0, replies: 0, duplicate: 0, invalid: 0, lowAmount: 0, noWs: 0, effectiveRate: null, customerReplyRate: null, duplicateRate: null, invalidRate: null, matureSample: 0, matureOrders: 0, matureOrderRate: null },
    execution: { receptionReply: rate(0, 0), receptionJoin: rate(0, 0), operatorExpert: rate(0, 0), expertOrder: rate(0, 0) },
    groups: [], daily: [],
  };

  const batchWhere = {
    groupId: { in: scope.groupIds },
    ...(scope.channelIds ? { channelId: { in: scope.channelIds } } : {}),
    sourceDate: { gte: scope.sourceDateFrom, lte: scope.sourceDateTo },
    ...(scope.normalizedName ? { channel: { normalizedName: scope.normalizedName } } : {}),
  } as const;
  const [sourceEvents, importEvents, leads, approvedInvalidReports] = await Promise.all([
    loadCanonicalMetricEvents({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom: scope.sourceDateFrom,
      sourceDateTo: scope.sourceDateTo,
      normalizedName: scope.normalizedName,
      occurredOnTo: today,
    }),
    db.metricEvent.findMany({
      where: {
        derivedFromLedger: true,
        voidedAt: null,
        kind: { in: ["NEW_FANS", "EFFECTIVE_FANS", "NO_NUMBER", "DUPLICATE_FANS"] },
        // 历史补录没有“导入粉”事实，不能出现在资源质量口径里。
        batch: { ...batchWhere, isHistoricalRecord: false },
      },
      select: {
        kind: true, quantity: true, occurredOn: true,
        batch: { select: { sourceDate: true, group: { select: { id: true, name: true } } } },
      },
    }) as Promise<ImportFact[]>,
    db.leadCustomer.findMany({
      // 这里只用于无效、回复、入群和时效健康度；历史客户只通过
      // canonical-events 提供开单及资金事实。
      where: { isHistoricalRecord: false, batch: { ...batchWhere, isHistoricalRecord: false } },
      select: {
        invalid: true, receptionCategory: true,
        repliedOn: true, joinedOn: true, expertIntroducedOn: true, expertOwnerId: true,
        batch: { select: { sourceDate: true, group: { select: { id: true } } } },
        customerOrder: { select: { openedOn: true, voidedAt: true } },
      },
    }),
    getApprovedInvalidFanTotals({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom: scope.sourceDateFrom,
      sourceDateTo: scope.sourceDateTo,
      normalizedChannelName: scope.normalizedName,
    }),
  ]);

  const imported = importTotals(importEvents);
  const sourceTotals = calculateBatchTotals(sourceEvents);
  // 没有新导入账本的历史批次，回退到旧统计口径。
  const approvedInvalid = approvedInvalidReports.reduce((sum, report) => ({
    noWsCount: sum.noWsCount + report.noWsCount,
    lowAmountCount: sum.lowAmountCount + report.lowAmountCount,
    collisionCount: sum.collisionCount + report.collisionCount,
    total: sum.total + report.total,
  }), { noWsCount: 0, lowAmountCount: 0, collisionCount: 0, total: 0 });
  const submitted = (imported.submitted || sourceTotals.newFans) + approvedInvalid.total;
  const importedEffective = imported.submitted ? imported.effective : sourceTotals.effectiveFans;
  const duplicate = (imported.submitted ? imported.duplicate : sourceTotals.duplicateFans) + approvedInvalid.collisionCount;
  const importInvalid = imported.submitted ? imported.invalid : sourceTotals.noNumber;
  const lowAmount = leads.filter((lead) => lead.invalid && lead.receptionCategory === "LOW_AMOUNT").length + approvedInvalid.lowAmountCount;
  const noWs = leads.filter((lead) => lead.invalid && lead.receptionCategory === "NO_WS").length + approvedInvalid.noWsCount;
  // 旧版作废记录继续从有效数据中排除，但不再作为业务分类展示或允许新建。
  const legacyVoided = leads.filter((lead) => lead.invalid && lead.receptionCategory !== "LOW_AMOUNT" && lead.receptionCategory !== "NO_WS").length;
  const reclassifiedInvalid = lowAmount + noWs + legacyVoided;
  const effective = Math.max(0, importedEffective - reclassifiedInvalid);
  const invalid = importInvalid + reclassifiedInvalid + approvedInvalid.total;
  const matureTotals = calculateBatchTotals(sourceEvents.filter((event) =>
    getMaturity(event.batch.sourceDate, today).d7 && isWithinMaturityWindow(event.batch.sourceDate, event.occurredOn, 7),
  ));

  const workableLeads = leads.filter((lead) => !lead.invalid);
  const replyDue = workableLeads.filter((lead) => lead.batch.sourceDate <= addDays(today, -1));
  const replyDone = replyDue.filter((lead) => Boolean(lead.repliedOn && lead.repliedOn <= addDays(lead.batch.sourceDate, 1)));
  const joinDue = workableLeads.filter((lead) => Boolean(lead.repliedOn && lead.repliedOn <= addDays(today, -1)));
  const joinDone = joinDue.filter((lead) => Boolean(lead.joinedOn && lead.repliedOn && lead.joinedOn <= addDays(lead.repliedOn, 1)));
  const introDue = workableLeads.filter((lead) => Boolean(lead.joinedOn && lead.joinedOn <= addDays(today, -2)));
  const introDone = introDue.filter((lead) => Boolean(lead.expertIntroducedOn && lead.joinedOn && lead.expertIntroducedOn <= addDays(lead.joinedOn, 2)));
  const orderDue = workableLeads.filter((lead) => Boolean(lead.expertOwnerId && lead.expertIntroducedOn && lead.expertIntroducedOn <= addDays(today, -1)));
  const orderDone = orderDue.filter((lead) => Boolean(lead.customerOrder && !lead.customerOrder.voidedAt));

  const importByGroup = new Map<string, ImportFact[]>();
  for (const event of importEvents) {
    const current = importByGroup.get(event.batch.group.id) ?? [];
    current.push(event);
    importByGroup.set(event.batch.group.id, current);
  }
  const canonicalByGroup = new Map<string, CanonicalMetricEvent[]>();
  for (const event of sourceEvents) {
    const current = canonicalByGroup.get(event.batch.group.id) ?? [];
    current.push(event);
    canonicalByGroup.set(event.batch.group.id, current);
  }
  const reclassifiedByGroup = new Map<string, number>();
  const reclassifiedBySourceGroup = new Map<string, number>();
  for (const lead of leads) {
    if (!lead.invalid) continue;
    const groupId = lead.batch.group.id;
    reclassifiedByGroup.set(groupId, (reclassifiedByGroup.get(groupId) ?? 0) + 1);
    const sourceKey = groupKey(lead.batch.sourceDate, groupId);
    reclassifiedBySourceGroup.set(sourceKey, (reclassifiedBySourceGroup.get(sourceKey) ?? 0) + 1);
  }
  const approvedInvalidByGroup = new Map<string, { total: number; groupName: string }>();
  const approvedInvalidBySourceGroup = new Map<string, { total: number; noWsCount: number; lowAmountCount: number; collisionCount: number; groupName: string }>();
  for (const report of approvedInvalidReports) {
    const group = approvedInvalidByGroup.get(report.groupId) ?? { total: 0, groupName: report.groupName };
    group.total += report.total;
    approvedInvalidByGroup.set(report.groupId, group);
    const sourceKey = groupKey(report.sourceDate, report.groupId);
    const source = approvedInvalidBySourceGroup.get(sourceKey) ?? { total: 0, noWsCount: 0, lowAmountCount: 0, collisionCount: 0, groupName: report.groupName };
    source.total += report.total;
    source.noWsCount += report.noWsCount;
    source.lowAmountCount += report.lowAmountCount;
    source.collisionCount += report.collisionCount;
    approvedInvalidBySourceGroup.set(sourceKey, source);
  }
  const groupIds = new Set([...importByGroup.keys(), ...canonicalByGroup.keys(), ...reclassifiedByGroup.keys(), ...approvedInvalidByGroup.keys()]);
  const groups = [...groupIds].map((id): ResourceGroupRow => {
    const facts = canonicalByGroup.get(id) ?? [];
    const totals = calculateBatchTotals(facts);
    const importFacts = importByGroup.get(id) ?? [];
    const imports = importTotals(importFacts);
    const groupSubmitted = (imports.submitted || totals.newFans) + (approvedInvalidByGroup.get(id)?.total ?? 0);
    const importedGroupEffective = imports.submitted ? imports.effective : totals.effectiveFans;
    const groupEffective = Math.max(0, importedGroupEffective - (reclassifiedByGroup.get(id) ?? 0));
    const mature = calculateBatchTotals(facts.filter((event) => getMaturity(event.batch.sourceDate, today).d7 && isWithinMaturityWindow(event.batch.sourceDate, event.occurredOn, 7)));
    const netPerformanceCents = totals.rechargeCents - totals.withdrawalCents;
    const matureRate = ratio(mature.orders, mature.newFans);
    const effectiveRate = ratio(groupEffective, groupSubmitted);
    const customerReplyRate = ratio(totals.replies, groupEffective);
    const receptionJoinRate = ratio(totals.groupJoin, groupEffective);
    const operatorExpertRate = ratio(totals.expertIntro, totals.groupJoin);
    const status = mature.newFans < 20 ? "INSUFFICIENT" as const
      : (effectiveRate ?? 0) < 0.6 || (matureRate ?? 0) < 0.05 ? "DANGER" as const
      : (effectiveRate ?? 0) < 0.75 || (matureRate ?? 0) < 0.1 ? "WARNING" as const
      : "NORMAL" as const;
    const first = importFacts[0]?.batch.group ?? facts[0]?.batch.group;
    return {
      groupId: id,
      groupName: first?.name ?? approvedInvalidByGroup.get(id)?.groupName ?? "未知小组",
      submitted: groupSubmitted,
      effectiveRate,
      customerReplyRate,
      receptionJoinRate,
      operatorExpertRate,
      matureOrderRate: matureRate,
      netPerformanceCents,
      status,
    };
  }).sort((left, right) => ({ DANGER: 0, WARNING: 1, INSUFFICIENT: 2, NORMAL: 3 })[left.status] - ({ DANGER: 0, WARNING: 1, INSUFFICIENT: 2, NORMAL: 3 })[right.status] || right.submitted - left.submitted);

  const activityEvents = dailyMode === "activity" ? await loadCanonicalMetricEvents({
    groupIds: scope.groupIds,
    channelIds: scope.channelIds,
    sourceDateTo: today,
    normalizedName: scope.normalizedName,
    occurredOnFrom: scope.sourceDateFrom,
    occurredOnTo: scope.sourceDateTo,
  }) : sourceEvents;
  const dailyMap = new Map<string, { date: string; groupId: string; groupName: string; totals: BatchTotals; importFacts: ImportFact[] }>();
  if (dailyMode === "source") {
    for (const event of importEvents) {
      const key = groupKey(event.batch.sourceDate, event.batch.group.id);
      const current = dailyMap.get(key) ?? { date: event.batch.sourceDate, groupId: event.batch.group.id, groupName: event.batch.group.name, totals: emptyBatchTotals(), importFacts: [] };
      current.importFacts.push(event);
      dailyMap.set(key, current);
    }
    for (const report of approvedInvalidReports) {
      const key = groupKey(report.sourceDate, report.groupId);
      const current = dailyMap.get(key) ?? { date: report.sourceDate, groupId: report.groupId, groupName: report.groupName, totals: emptyBatchTotals(), importFacts: [] };
      dailyMap.set(key, current);
    }
  }
  for (const event of activityEvents) {
    const date = dailyMode === "source" ? event.batch.sourceDate : event.occurredOn;
    const key = groupKey(date, event.batch.group.id);
    const current = dailyMap.get(key) ?? { date, groupId: event.batch.group.id, groupName: event.batch.group.name, totals: emptyBatchTotals(), importFacts: [] };
    const single = calculateBatchTotals([event]);
    for (const metric of Object.keys(current.totals) as Array<keyof BatchTotals>)
      current.totals[metric] = (current.totals[metric] ?? 0) + (single[metric] ?? 0);
    dailyMap.set(key, current);
  }
  const daily = [...dailyMap.values()].map((item): ResourceDailyRow => {
    const imports = importTotals(item.importFacts);
    const manual = approvedInvalidBySourceGroup.get(groupKey(item.date, item.groupId))?.total ?? 0;
    return {
      key: groupKey(item.date, item.groupId), date: item.date, groupId: item.groupId, groupName: item.groupName,
      submitted: dailyMode === "source" ? (imports.submitted || item.totals.newFans) + manual : item.totals.newFans,
      effective: dailyMode === "source" ? Math.max(0, (imports.submitted ? imports.effective : item.totals.effectiveFans) - (reclassifiedBySourceGroup.get(groupKey(item.date, item.groupId)) ?? 0)) : item.totals.effectiveFans,
      replies: item.totals.replies, joined: item.totals.groupJoin, introduced: item.totals.expertIntro,
      registered: item.totals.registration, orders: item.totals.orders,
      mature: dailyMode === "activity" || getMaturity(item.date, today).d7,
    };
  }).sort((left, right) => right.date.localeCompare(left.date) || left.groupName.localeCompare(right.groupName, "zh-CN")).slice(0, 200);

  return {
    quality: {
      submitted, effective, replies: sourceTotals.replies, duplicate, invalid, lowAmount, noWs,
      effectiveRate: ratio(effective, submitted), customerReplyRate: ratio(sourceTotals.replies, effective),
      duplicateRate: ratio(duplicate, submitted), invalidRate: ratio(invalid, submitted),
      matureSample: matureTotals.newFans, matureOrders: matureTotals.orders, matureOrderRate: ratio(matureTotals.orders, matureTotals.newFans),
    },
    execution: {
      receptionReply: rate(replyDue.length, replyDone.length),
      receptionJoin: rate(joinDue.length, joinDone.length),
      operatorExpert: rate(introDue.length, introDone.length),
      expertOrder: rate(orderDue.length, orderDone.length),
    },
    groups,
    daily,
  };
}
