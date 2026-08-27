import { db } from "../db";
import { calculateBatchTotals, calculateConversionRates, type BatchTotals, type ConversionRates, type MetricEvent } from "../metrics";
import { getBatchStatus, getDeepestStage, getLargestDrop, getMaturity, type BatchStatus, type FunnelStage } from "./metrics";
import { isWithinMaturityWindow } from "./maturity-window";
import type { AnalysisScope } from "./types";
import { loadCanonicalMetricEvents } from "./canonical-events";

export type BatchTrackingRow = {
  key: string;
  batchId: string;
  memberId: string;
  sourceDate: string;
  normalizedName: string;
  channelName: string;
  memberName: string;
  groupId: string;
  groupName: string;
  ageDays: number;
  ageLabel: "D0" | "D1–3" | "D4–7" | "D8–14" | "D15+";
  totals: BatchTotals;
  currentStage: FunnelStage;
  largestDrop: ReturnType<typeof getLargestDrop> | null;
  status: BatchStatus;
};

export type BatchDetail = BatchTrackingRow & {
  channelType: "SMS" | "ADS" | "REBATE";
  advertisingSpendCents: number | null;
  advertisingFanCount: number | null;
  advertisingServiceFeeRateBps: number | null;
  effectiveFanPriceCentsSnapshot: number | null;
  rates: ConversionRates;
  maturity: ReturnType<typeof getMaturity>;
  d7: { state: "MATURE" | "PENDING"; totals: BatchTotals; rates: ConversionRates };
  d14: { state: "MATURE" | "PENDING"; totals: BatchTotals; rates: ConversionRates };
  trend: Array<{ occurredOn: string; totals: BatchTotals }>;
  history: Array<{ id: string; occurredOn: string; kind: MetricEvent["kind"]; quantity: number | null; amountCents: number | null }>;
  customers: Array<{
    id: string;
    phone: string;
    customerName: string | null;
    stage: string;
    currentOwner: string;
    groupStatus: string;
    nextPlan: string | null;
  }>;
};

const ageLabel = (days: number): BatchTrackingRow["ageLabel"] => days === 0 ? "D0" : days <= 3 ? "D1–3" : days <= 7 ? "D4–7" : days <= 14 ? "D8–14" : "D15+";
const statusOrder: Record<BatchStatus, number> = { DATA_ANOMALY: 0, STALLED: 1, NORMAL: 2, INSUFFICIENT: 3, ORDERED: 4 };

type TrackingEvent = MetricEvent & {
  id: string;
  batchId: string;
  enteredById: string;
  occurredOn: string;
  batch: { sourceDate: string; group: { id: string; name: string }; channel: { name: string; normalizedName: string } };
  enteredBy: { id: string; name: string };
};

const rowFromEvents = (events: TrackingEvent[], today: string): BatchTrackingRow => {
  const first = events[0];
  const totals = calculateBatchTotals(events);
  const maturity = getMaturity(first.batch.sourceDate, today);
  const currentStage = getDeepestStage(totals);
  const progression = events
    .filter((event) => event.kind === currentStage && (event.quantity ?? 0) > 0)
    .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn))[0]?.occurredOn ?? null;
  return {
    key: `${first.batchId}:${first.enteredById}`,
    batchId: first.batchId,
    memberId: first.enteredById,
    sourceDate: first.batch.sourceDate,
    normalizedName: first.batch.channel.normalizedName,
    channelName: first.batch.channel.name,
    memberName: first.enteredBy.name,
    groupId: first.batch.group.id,
    groupName: first.batch.group.name,
    ageDays: maturity.ageDays,
    ageLabel: ageLabel(maturity.ageDays),
    totals,
    currentStage,
    largestDrop: events.length ? getLargestDrop(totals) : null,
    status: getBatchStatus({ totals, sourceDate: first.batch.sourceDate, today, lastProgressedOn: progression }),
  };
};

async function loadEvents(scope: AnalysisScope, today: string, batchId?: string, memberId?: string): Promise<TrackingEvent[]> {
  if (scope.requestedForbiddenGroup || scope.groupIds.length === 0) return [];
  return loadCanonicalMetricEvents({
    groupIds: scope.groupIds,
    channelIds: scope.channelIds,
    sourceDateFrom: scope.sourceDateFrom,
    sourceDateTo: scope.sourceDateTo,
    normalizedName: scope.normalizedName,
    batchId: batchId ?? scope.batchId,
    memberId: memberId ?? scope.memberId,
    occurredOnTo: today,
  });
}

export async function loadBatchTracking(scope: AnalysisScope, today: string) {
  const events = await loadEvents(scope, today);
  const grouped = new Map<string, TrackingEvent[]>();
  for (const event of events) (grouped.get(`${event.batchId}:${event.enteredById}`) ?? grouped.set(`${event.batchId}:${event.enteredById}`, []).get(`${event.batchId}:${event.enteredById}`)!).push(event);
  const rows = [...grouped.values()].map((ownerEvents) => rowFromEvents(ownerEvents, today)).sort((left, right) => statusOrder[left.status] - statusOrder[right.status]
    || right.ageDays - left.ageDays
    || left.sourceDate.localeCompare(right.sourceDate)
    || left.channelName.localeCompare(right.channelName, "zh-CN")
    || left.memberName.localeCompare(right.memberName, "zh-CN"));
  return { rows };
}

export async function loadBatchDetail(scope: AnalysisScope, batchId: string, memberId: string | undefined, today: string): Promise<BatchDetail | null> {
  if (!memberId || scope.groupIds.length === 0) return null;
  const events: TrackingEvent[] = await loadCanonicalMetricEvents({
    groupIds: scope.groupIds,
    channelIds: scope.channelIds,
    batchId,
    memberId,
    occurredOnTo: today,
  });
  if (!events.length || events.some((event) => event.batchId !== batchId || event.enteredById !== memberId || !scope.groupIds.includes(event.batch.group.id))) return null;
  const row = rowFromEvents(events, today);
  const batch = await db.sourceBatch.findFirst({
    where: { id: batchId, groupId: { in: scope.groupIds }, ...(scope.channelIds ? { channelId: { in: scope.channelIds } } : {}) },
    select: {
      channelTypeSnapshot: true,
      advertisingSpendCents: true,
      advertisingFanCount: true,
      advertisingServiceFeeRateBps: true,
      effectiveFanPriceCentsSnapshot: true,
    },
  });
  if (!batch) return null;
  const maturity = getMaturity(row.sourceDate, today);
  const window = (days: 7 | 14) => {
    const mature = days === 7 ? maturity.d7 : maturity.d14;
    const totals = calculateBatchTotals(mature ? events.filter((event) => isWithinMaturityWindow(row.sourceDate, event.occurredOn, days)) : []);
    return { state: (mature ? "MATURE" : "PENDING") as "MATURE" | "PENDING", totals, rates: calculateConversionRates(totals) };
  };
  const daily = new Map<string, TrackingEvent[]>();
  for (const event of events) (daily.get(event.occurredOn) ?? daily.set(event.occurredOn, []).get(event.occurredOn)!).push(event);
  const customerRows = await db.leadCustomer.findMany({
    // 批次数字已经按“粉的归属”筛选，明细也必须使用同一字段，避免数字与客户列表对不上。
    where: {
      batchId,
      OR: [
        { attributionOwnerId: memberId },
        { attributionOwnerId: null, ownerId: memberId },
      ],
    },
    select: {
      id: true,
      phone: true,
      customerName: true,
      invalid: true,
      groupStatus: true,
      expertIntroducedOn: true,
      registeredOn: true,
      nextPlan: true,
      owner: {
        select: {
          name: true,
          receptionistAssignments: {
            where: { groupOperator: { active: true } },
            select: { groupOperator: { select: { name: true } } },
          },
        },
      },
      expertOwner: { select: { name: true } },
      customerOrder: { select: { voidedAt: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  const customers = customerRows.map((customer) => {
    const activeOrder = Boolean(customer.customerOrder && !customer.customerOrder.voidedAt);
    const stage = customer.invalid
      ? "无效粉"
      : customer.groupStatus === "LEFT"
        ? "已退群"
        : activeOrder
          ? "已开单"
          : customer.registeredOn
            ? "已注册 · 待开单"
            : customer.expertIntroducedOn
              ? "已推专家 · 待注册"
              : customer.groupStatus === "JOINED"
                ? "在群 · 待推专家"
                : "前台接粉跟进中";
    const groupOperators = customer.owner.receptionistAssignments.map((item) => item.groupOperator.name);
    const currentOwner = customer.expertOwner?.name
      ? `${customer.expertOwner.name}（专家）`
      : customer.groupStatus === "JOINED" && groupOperators.length
        ? `${groupOperators.join("、")}（炒群）`
        : `${customer.owner.name}（接粉）`;
    return {
      id: customer.id,
      phone: customer.phone,
      customerName: customer.customerName,
      stage,
      currentOwner,
      groupStatus: customer.groupStatus,
      nextPlan: customer.nextPlan,
    };
  });
  return {
    ...row,
    channelType: batch.channelTypeSnapshot,
    advertisingSpendCents: batch.advertisingSpendCents,
    advertisingFanCount: batch.advertisingFanCount,
    advertisingServiceFeeRateBps: batch.advertisingServiceFeeRateBps,
    effectiveFanPriceCentsSnapshot: batch.effectiveFanPriceCentsSnapshot,
    rates: calculateConversionRates(row.totals),
    maturity,
    d7: window(7),
    d14: window(14),
    trend: [...daily.entries()].map(([occurredOn, dayEvents]) => ({ occurredOn, totals: calculateBatchTotals(dayEvents) })),
    history: events.map(({ id, occurredOn, kind, quantity, amountCents }) => ({ id, occurredOn, kind, quantity: quantity ?? null, amountCents: amountCents ?? null })).reverse(),
    customers,
  };
}
