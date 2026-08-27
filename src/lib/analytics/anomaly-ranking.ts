import { normalizeChannelName } from "../channel-names";
import { calculateBatchTotals, type BatchTotals, type MetricEvent } from "../metrics";
import { loadCanonicalMetricEvents, type CanonicalMetricEvent } from "./canonical-events";
import { getMaturity, getSampleState, hasFunnelAnomaly } from "./metrics";
import { isWithinMaturityWindow } from "./maturity-window";
import type { AnalysisScope } from "./types";

export type AnomalyMetricKey = "replyRate" | "groupRate" | "expertRate" | "registrationRate" | "orderRate";

export type AnomalyMetricComparison = {
  value: number | null;
  average: number | null;
  gap: number | null;
  status: "LOW" | "OK" | "UNAVAILABLE" | "INSUFFICIENT";
};

export type AnomalyRankingRow = {
  key: string;
  memberId: string;
  memberName: string;
  memberActive: boolean;
  role: "LEAD" | "RECEPTION";
  groupId: string;
  groupName: string;
  normalizedName: string;
  channelName: string;
  newFans: number;
  rankable: boolean;
  metrics: Record<AnomalyMetricKey, AnomalyMetricComparison>;
  anomalyCount: number;
  largestGap: number | null;
};

export type AnomalyRankingSummary = {
  anomalousMemberCount: number;
  affectedChannelCount: number;
  largestGap: number | null;
};

export type AnomalyRankingResult = {
  rows: AnomalyRankingRow[];
  summary: AnomalyRankingSummary;
  channelOptions: Array<{ normalizedName: string; name: string }>;
  hasMatureData: boolean;
  hasComparableData: boolean;
  totalComparedRows: number;
};

type RankingEvent = CanonicalMetricEvent;

type MemberChannelAggregate = {
  memberId: string;
  memberName: string;
  memberActive: boolean;
  role: "RECEPTION";
  groupId: string;
  groupName: string;
  normalizedName: string;
  channelName: string;
  totals: BatchTotals;
  rankable: boolean;
};

const metricKeys: AnomalyMetricKey[] = ["replyRate", "groupRate", "expertRate", "registrationRate", "orderRate"];

function fraction(totals: BatchTotals, key: AnomalyMetricKey): { numerator: number; denominator: number } {
  if (key === "replyRate") return { numerator: totals.replies, denominator: totals.effectiveFans };
  if (key === "groupRate") return { numerator: totals.groupJoin, denominator: totals.replies };
  if (key === "expertRate") return { numerator: totals.expertIntro, denominator: totals.groupJoin };
  if (key === "registrationRate") return { numerator: totals.registration, denominator: totals.expertIntro };
  return { numerator: totals.orders, denominator: totals.registration };
}

function divide({ numerator, denominator }: { numerator: number; denominator: number }): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function addTotals(rows: MemberChannelAggregate[], key: AnomalyMetricKey): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    const part = fraction(row.totals, key);
    if (part.denominator === 0) continue;
    numerator += part.numerator;
    denominator += part.denominator;
  }
  return denominator === 0 ? null : numerator / denominator;
}

function buildRows(aggregates: MemberChannelAggregate[], showInsufficient: boolean): { allCompared: AnomalyRankingRow[]; visible: AnomalyRankingRow[] } {
  const byChannel = new Map<string, MemberChannelAggregate[]>();
  for (const row of aggregates) {
    const current = byChannel.get(row.normalizedName) ?? [];
    current.push(row);
    byChannel.set(row.normalizedName, current);
  }

  const allCompared = aggregates.map((row): AnomalyRankingRow => {
    const rankablePeers = (byChannel.get(row.normalizedName) ?? []).filter((peer) => peer.rankable);
    const metrics = Object.fromEntries(metricKeys.map((key) => {
      const value = divide(fraction(row.totals, key));
      const average = addTotals(rankablePeers, key);
      if (!row.rankable) return [key, { value, average, gap: null, status: "INSUFFICIENT" } satisfies AnomalyMetricComparison];
      if (value === null || average === null) return [key, { value, average, gap: null, status: "UNAVAILABLE" } satisfies AnomalyMetricComparison];
      const gap = value - average;
      return [key, { value, average, gap, status: gap < 0 ? "LOW" : "OK" } satisfies AnomalyMetricComparison];
    })) as Record<AnomalyMetricKey, AnomalyMetricComparison>;
    const lowGaps = metricKeys.map((key) => metrics[key]).filter((metric) => metric.status === "LOW" && metric.gap !== null).map((metric) => metric.gap!);
    return {
      key: `${row.groupId}\0${row.memberId}\0${row.normalizedName}`,
      memberId: row.memberId,
      memberName: row.memberName,
      memberActive: row.memberActive,
      role: row.role,
      groupId: row.groupId,
      groupName: row.groupName,
      normalizedName: row.normalizedName,
      channelName: row.channelName,
      newFans: row.totals.newFans,
      rankable: row.rankable,
      metrics,
      anomalyCount: lowGaps.length,
      largestGap: lowGaps.length === 0 ? null : Math.min(...lowGaps),
    };
  });

  const visible = allCompared.filter((row) => row.anomalyCount > 0 || (showInsufficient && !row.rankable)).sort((left, right) =>
    right.anomalyCount - left.anomalyCount
    || (left.largestGap ?? 0) - (right.largestGap ?? 0)
    || left.memberName.localeCompare(right.memberName, "zh-CN")
    || left.channelName.localeCompare(right.channelName, "zh-CN"),
  );
  return { allCompared, visible };
}

export async function loadAnomalyRanking(
  scope: AnalysisScope,
  today: string,
  options: { showInsufficient?: boolean } = {},
): Promise<AnomalyRankingResult> {
  if (scope.requestedForbiddenGroup || scope.groupIds.length === 0) {
    return { rows: [], summary: { anomalousMemberCount: 0, affectedChannelCount: 0, largestGap: null }, channelOptions: [], hasMatureData: false, hasComparableData: false, totalComparedRows: 0 };
  }

  const events = (await loadCanonicalMetricEvents({
    groupIds: scope.groupIds,
    channelIds: scope.channelIds,
    sourceDateFrom: scope.sourceDateFrom,
    sourceDateTo: scope.sourceDateTo,
    normalizedName: scope.normalizedName ? normalizeChannelName(scope.normalizedName) : undefined,
    occurredOnTo: today,
  })).filter((event) => scope.includeInactive || event.enteredBy.active);

  const matureEvents = events.filter((event) => getMaturity(event.batch.sourceDate, today).d7
    && isWithinMaturityWindow(event.batch.sourceDate, event.occurredOn, 7));
  const grouped = new Map<string, { metadata: Omit<MemberChannelAggregate, "totals" | "rankable">; events: RankingEvent[] }>();
  const channelOptions = new Map<string, string>();

  for (const event of matureEvents) {
    const normalizedName = normalizeChannelName(event.batch.channel.normalizedName || event.batch.channel.name);
    channelOptions.set(normalizedName, event.batch.channel.name.trim());
    const key = `${event.batch.group.id}\0${event.enteredById}\0${normalizedName}`;
    const current = grouped.get(key) ?? {
      metadata: {
        memberId: event.enteredById,
        memberName: event.enteredBy.name,
        memberActive: event.enteredBy.active,
        role: event.enteredBy.role,
        groupId: event.batch.group.id,
        groupName: event.batch.group.name,
        normalizedName,
        channelName: event.batch.channel.name.trim(),
      },
      events: [],
    };
    current.events.push(event);
    grouped.set(key, current);
  }

  const aggregates = [...grouped.values()].map(({ metadata, events }): MemberChannelAggregate => {
    const totals = calculateBatchTotals(events);
    return { ...metadata, totals, rankable: getSampleState(totals.newFans) === "RANKABLE" };
  }).filter((row) => !hasFunnelAnomaly(row.totals));
  const { allCompared, visible } = buildRows(aggregates, options.showInsufficient === true);
  const anomalousRows = allCompared.filter((row) => row.anomalyCount > 0);
  const largestGaps = anomalousRows.map((row) => row.largestGap).filter((gap): gap is number => gap !== null);
  const rankableByChannel = new Map<string, number>();
  for (const row of aggregates.filter((item) => item.rankable)) rankableByChannel.set(row.normalizedName, (rankableByChannel.get(row.normalizedName) ?? 0) + 1);

  return {
    rows: visible,
    summary: {
      anomalousMemberCount: new Set(anomalousRows.map((row) => row.memberId)).size,
      affectedChannelCount: new Set(anomalousRows.map((row) => row.normalizedName)).size,
      largestGap: largestGaps.length === 0 ? null : Math.min(...largestGaps),
    },
    channelOptions: [...channelOptions.entries()].map(([normalizedName, name]) => ({ normalizedName, name })).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    hasMatureData: matureEvents.length > 0,
    hasComparableData: [...rankableByChannel.values()].some((count) => count >= 2),
    totalComparedRows: allCompared.filter((row) => row.rankable).length,
  };
}
