import { calculateBatchTotals, type BatchTotals, type MetricEvent } from "../metrics";

export const funnelStages = [
  "NEW_FANS", "REPLIES", "GROUP_JOIN", "EXPERT_INTRO", "REGISTRATION", "ORDER",
] as const;

export type FunnelStage = (typeof funnelStages)[number];
export type SampleState = "INSUFFICIENT" | "RANKABLE";
export type BatchStatus = "DATA_ANOMALY" | "ORDERED" | "INSUFFICIENT" | "STALLED" | "NORMAL";

const valueForStage = (totals: BatchTotals, stage: FunnelStage): number => ({
  NEW_FANS: totals.newFans,
  REPLIES: totals.replies,
  GROUP_JOIN: totals.groupJoin,
  EXPERT_INTRO: totals.expertIntro,
  REGISTRATION: totals.registration,
  ORDER: totals.orders,
})[stage];

function calendarDaysBetween(later: string, earlier: string): number {
  const start = new Date(`${earlier}T00:00:00Z`);
  const end = new Date(`${later}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function aggregateEventsByOwner(events: (MetricEvent & { enteredById: string })[]): Record<string, BatchTotals> {
  const eventsByOwner: Record<string, MetricEvent[]> = {};
  for (const event of events) (eventsByOwner[event.enteredById] ??= []).push(event);
  return Object.fromEntries(Object.entries(eventsByOwner).map(([ownerId, ownerEvents]) => [ownerId, calculateBatchTotals(ownerEvents)]));
}

export function getMaturity(sourceDate: string, today: string) {
  const ageDays = Math.max(0, calendarDaysBetween(today, sourceDate));
  return { ageDays, d7: ageDays >= 7, d14: ageDays >= 14 };
}

export function getSampleState(newFans: number): SampleState {
  return newFans >= 20 ? "RANKABLE" : "INSUFFICIENT";
}

export function hasFunnelAnomaly(totals: BatchTotals): boolean {
  return totals.groupJoin > totals.newFans
    || totals.expertIntro > totals.groupJoin
    || totals.registration > totals.expertIntro
    || totals.orders > totals.newFans
    || totals.groupLeave > totals.groupJoin;
}

export function getLargestDrop(totals: BatchTotals) {
  let largest = { from: funnelStages[0], to: funnelStages[1], lost: 0 } as { from: FunnelStage; to: FunnelStage; lost: number };
  for (let index = 0; index < funnelStages.length - 1; index += 1) {
    const from = funnelStages[index];
    const to = funnelStages[index + 1];
    const lost = valueForStage(totals, from) - valueForStage(totals, to);
    if (lost > largest.lost) largest = { from, to, lost };
  }
  return largest;
}

export function getDeepestStage(totals: BatchTotals): FunnelStage {
  return [...funnelStages].reverse().find((stage) => valueForStage(totals, stage) > 0) ?? "NEW_FANS";
}

export function getBatchStatus(input: {
  totals: BatchTotals;
  sourceDate: string;
  today: string;
  lastProgressedOn?: string | null;
}): BatchStatus {
  if (hasFunnelAnomaly(input.totals)) return "DATA_ANOMALY";
  if (input.totals.orders > 0) return "ORDERED";
  if (getSampleState(input.totals.newFans) === "INSUFFICIENT") return "INSUFFICIENT";

  const maturity = getMaturity(input.sourceDate, input.today);
  const stalledForDays = input.lastProgressedOn ? calendarDaysBetween(input.today, input.lastProgressedOn) >= 3 : false;
  if (maturity.ageDays >= 4 && stalledForDays) return "STALLED";
  return "NORMAL";
}
