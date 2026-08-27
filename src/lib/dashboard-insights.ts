import { calculateBatchTotals, type MetricEvent } from "./metrics";

type OccurredMetricEvent = MetricEvent & { occurredOn: string };
type AnomalyMetricEvent = OccurredMetricEvent & { batchId: string; channelName: string };

export type DashboardTrendPoint = {
  date: string;
  newFans: number;
  groupJoin: number;
  registration: number;
  orders: number;
};

export type DashboardAnomaly = { id: string; label: string; replies: number };

export function buildDashboardTrend(events: OccurredMetricEvent[]): DashboardTrendPoint[] {
  const byDate = new Map<string, MetricEvent[]>();
  for (const event of events) {
    const current = byDate.get(event.occurredOn) ?? [];
    current.push(event);
    byDate.set(event.occurredOn, current);
  }

  return [...byDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-14)
    .map(([date, dailyEvents]) => {
      const totals = calculateBatchTotals(dailyEvents);
      return { date, newFans: totals.newFans, groupJoin: totals.groupJoin, registration: totals.registration, orders: totals.orders };
    });
}

export function findDailyReplyAnomalies(events: AnomalyMetricEvent[]): DashboardAnomaly[] {
  const buckets = new Map<string, { batchId: string; occurredOn: string; channelName: string; replies: number; newFans: number }>();
  for (const event of events) {
    const key = `${event.batchId}\0${event.occurredOn}`;
    const current = buckets.get(key) ?? { batchId: event.batchId, occurredOn: event.occurredOn, channelName: event.channelName, replies: 0, newFans: 0 };
    if (event.kind === "REPLIES") current.replies += event.quantity ?? 0;
    if (event.kind === "NEW_FANS") current.newFans += event.quantity ?? 0;
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .filter((item) => item.replies > 0 && item.newFans <= 0)
    .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn) || left.channelName.localeCompare(right.channelName, "zh-CN"))
    .map((item) => ({ id: `${item.batchId}:${item.occurredOn}`, label: `${item.occurredOn} · ${item.channelName}`, replies: item.replies }));
}
