import { normalizeChannelName } from "../channel-names";
import { db } from "../db";
import { calculateBatchTotals, calculateConversionRates, type BatchTotals, type ConversionRates, type MetricEvent } from "../metrics";
import { getMaturity, getSampleState } from "./metrics";
import { isWithinMaturityWindow } from "./maturity-window";
import type { AnalysisScope } from "./types";
import { loadCanonicalMetricEvents } from "./canonical-events";
import { getApprovedInvalidFanTotals, type ApprovedInvalidFanReportTotal } from "../invalid-fan-reports";

export type ChannelQualityRow = {
  normalizedName: string;
  displayName: string;
  newFans: number;
  groupRate: number | null;
  registrationRate: number | null;
  orderRate: number | null;
  rechargePerOrderCents: number | null;
  rankable: boolean;
  groupCount: number;
  groups: string[];
  totals: BatchTotals;
  rates: ConversionRates;
  submitted?: number;
  effective?: number;
  duplicate?: number;
  invalid?: number;
  effectiveRate?: number | null;
  customerReplyRate?: number | null;
  duplicateRate?: number | null;
  invalidRate?: number | null;
  d7Sample?: number;
  d7Orders?: number;
  d7OrderRate?: number | null;
  lowAmount?: number;
  noWs?: number;
};

export type MatureChannelWindow = {
  state: "MATURE" | "PENDING";
  totals: BatchTotals;
  rates: ConversionRates;
};

export type ChannelDetail = {
  normalizedName: string;
  displayName: string;
  row: ChannelQualityRow;
  replyRate: number | null;
  rechargePerOrderCents: number | null;
  d7: MatureChannelWindow;
  d14: MatureChannelWindow;
  relatedBatches: Array<{ batchId: string; memberId: string; sourceDate: string; groupName: string }>;
};

type ChannelEvent = MetricEvent & {
  occurredOn: string;
  batchId: string;
  enteredById: string;
  batch: { sourceDate: string; group: { id: string; name: string }; channel: { name: string; normalizedName: string } };
};

type ImportChannelEvent = {
  kind: "NEW_FANS" | "EFFECTIVE_FANS" | "NO_NUMBER" | "DUPLICATE_FANS";
  quantity: number | null;
  batch: {
    sourceDate: string;
    group: { id: string; name: string };
    channel: { name: string; normalizedName: string };
  };
};

const ratio = (value: number, base: number) => base === 0 ? null : value / base;

const windowFor = (events: ChannelEvent[], today: string, days: 7 | 14): MatureChannelWindow => {
  const matureEvents = events.filter((event) => {
    const maturity = getMaturity(event.batch.sourceDate, today);
    const mature = days === 7 ? maturity.d7 : maturity.d14;
    return mature && isWithinMaturityWindow(event.batch.sourceDate, event.occurredOn, days);
  });
  const hasMatureBatch = events.some((event) => days === 7 ? getMaturity(event.batch.sourceDate, today).d7 : getMaturity(event.batch.sourceDate, today).d14);
  const totals = calculateBatchTotals(matureEvents);
  return { state: hasMatureBatch ? "MATURE" : "PENDING", totals, rates: calculateConversionRates(totals) };
};

export async function loadChannelAnalysis(scope: AnalysisScope, today: string) {
  if (scope.requestedForbiddenGroup || scope.groupIds.length === 0) return { rows: [] as ChannelQualityRow[], rankableRows: [] as ChannelQualityRow[], selectedChannelDetail: null as ChannelDetail | null };
  const normalizedFilter = scope.normalizedName ? normalizeChannelName(scope.normalizedName) : undefined;
  const [events, importEvents, classifiedLeads, approvedInvalidReports] = await Promise.all([
    loadCanonicalMetricEvents({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom: scope.sourceDateFrom,
      sourceDateTo: scope.sourceDateTo,
      normalizedName: normalizedFilter,
      memberId: scope.memberId,
      occurredOnTo: today,
    }),
    db.metricEvent.findMany({
      where: {
        derivedFromLedger: true,
        voidedAt: null,
        kind: { in: ["NEW_FANS", "EFFECTIVE_FANS", "NO_NUMBER", "DUPLICATE_FANS"] },
        ...(scope.memberId ? { enteredById: scope.memberId } : {}),
        batch: {
          groupId: { in: scope.groupIds },
          ...(scope.channelIds ? { channelId: { in: scope.channelIds } } : {}),
          sourceDate: { gte: scope.sourceDateFrom, lte: scope.sourceDateTo },
          ...(normalizedFilter ? { channel: { normalizedName: normalizedFilter } } : {}),
        },
      },
      select: {
        kind: true,
        quantity: true,
        batch: { select: {
          sourceDate: true,
          group: { select: { id: true, name: true } },
          channel: { select: { name: true, normalizedName: true } },
        } },
      },
    }) as Promise<ImportChannelEvent[]>,
    db.leadCustomer.findMany({
      where: {
        batch: {
          groupId: { in: scope.groupIds },
          ...(scope.channelIds ? { channelId: { in: scope.channelIds } } : {}),
          sourceDate: { gte: scope.sourceDateFrom, lte: scope.sourceDateTo },
          ...(normalizedFilter ? { channel: { normalizedName: normalizedFilter } } : {}),
        },
      },
      select: {
        invalid: true,
        receptionCategory: true,
        batch: { select: { channel: { select: { name: true, normalizedName: true } } } },
      },
    }),
    getApprovedInvalidFanTotals({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom: scope.sourceDateFrom,
      sourceDateTo: scope.sourceDateTo,
      ...(scope.memberId ? { reporterIds: [scope.memberId] } : {}),
    }),
  ]);

  const grouped = new Map<string, { displayName: string; events: ChannelEvent[]; imports: ImportChannelEvent[]; reports: ApprovedInvalidFanReportTotal[]; groups: Map<string, string> }>();
  for (const event of importEvents) {
    const key = normalizeChannelName(event.batch.channel.normalizedName || event.batch.channel.name);
    const current = grouped.get(key) ?? { displayName: event.batch.channel.name.trim(), events: [] as ChannelEvent[], imports: [] as ImportChannelEvent[], reports: [] as ApprovedInvalidFanReportTotal[], groups: new Map<string, string>() };
    current.imports.push(event);
    current.groups.set(event.batch.group.id, event.batch.group.name);
    grouped.set(key, current);
  }
  for (const event of events) {
    const key = normalizeChannelName(event.batch.channel.normalizedName || event.batch.channel.name);
    const current = grouped.get(key) ?? { displayName: event.batch.channel.name.trim(), events: [] as ChannelEvent[], imports: [] as ImportChannelEvent[], reports: [] as ApprovedInvalidFanReportTotal[], groups: new Map<string, string>() };
    current.events.push(event);
    current.groups.set(event.batch.group.id, event.batch.group.name);
    grouped.set(key, current);
  }
  for (const report of approvedInvalidReports) {
    const key = normalizeChannelName(report.normalizedChannelName || report.channelName);
    if (normalizedFilter && key !== normalizedFilter) continue;
    const current = grouped.get(key) ?? { displayName: report.channelName.trim(), events: [] as ChannelEvent[], imports: [] as ImportChannelEvent[], reports: [] as ApprovedInvalidFanReportTotal[], groups: new Map<string, string>() };
    current.reports.push(report);
    current.groups.set(report.groupId, report.groupName);
    grouped.set(key, current);
  }

  const classifications = new Map<string, { lowAmount: number; noWs: number; invalidCount: number }>();
  for (const lead of classifiedLeads) {
    const key = normalizeChannelName(lead.batch.channel.normalizedName || lead.batch.channel.name);
    const current = classifications.get(key) ?? { lowAmount: 0, noWs: 0, invalidCount: 0 };
    if (lead.receptionCategory === "LOW_AMOUNT") current.lowAmount += 1;
    else if (lead.receptionCategory === "NO_WS") current.noWs += 1;
    else if (lead.receptionCategory === "INVALID" || lead.invalid) current.invalidCount += 1;
    classifications.set(key, current);
  }

  const rows = [...grouped.entries()].map(([normalizedName, value]): ChannelQualityRow => {
    const totals = calculateBatchTotals(value.events);
    const rates = calculateConversionRates(totals);
    const importQuantity = (kind: ImportChannelEvent["kind"]) => value.imports.filter((event) => event.kind === kind).reduce((sum, event) => sum + (event.quantity ?? 0), 0);
    const approvedInvalid = value.reports.reduce((sum, report) => ({
      noWsCount: sum.noWsCount + report.noWsCount,
      lowAmountCount: sum.lowAmountCount + report.lowAmountCount,
      collisionCount: sum.collisionCount + report.collisionCount,
      total: sum.total + report.total,
    }), { noWsCount: 0, lowAmountCount: 0, collisionCount: 0, total: 0 });
    const importedSubmitted = importQuantity("NEW_FANS");
    // 历史汇总和启用后的号码数据可以同时存在于同一渠道，必须相加，不能二选一。
    const submitted = importedSubmitted + totals.newFans + approvedInvalid.total;
    const importedEffective = importQuantity("EFFECTIVE_FANS") + totals.effectiveFans;
    const duplicate = importQuantity("DUPLICATE_FANS") + totals.duplicateFans + approvedInvalid.collisionCount;
    const importInvalid = importQuantity("NO_NUMBER") + totals.noNumber;
    const d7 = windowFor(value.events, today, 7);
    const classified = classifications.get(normalizedName) ?? { lowAmount: 0, noWs: 0, invalidCount: 0 };
    const reclassifiedInvalid = classified.lowAmount + classified.noWs + classified.invalidCount;
    // 导入时的有效数需要扣掉后来被确认的低金额、无 WS 和旧版作废记录，
    // 才能和资源部及财务使用的有效数据口径一致。
    const effective = Math.max(0, importedEffective - reclassifiedInvalid);
    const invalid = importInvalid + reclassifiedInvalid + approvedInvalid.total;
    return {
      normalizedName,
      displayName: value.displayName,
      newFans: submitted,
      groupRate: rates.groupRate,
      registrationRate: rates.registrationRate,
      orderRate: rates.orderRate,
      rechargePerOrderCents: totals.orders === 0 ? null : totals.rechargeCents / totals.orders,
      rankable: getSampleState(submitted) === "RANKABLE",
      groupCount: value.groups.size,
      groups: [...value.groups.values()].sort((left, right) => left.localeCompare(right, "zh-CN")),
      totals,
      rates,
      submitted,
      effective,
      duplicate,
      invalid,
      effectiveRate: ratio(effective, submitted),
      customerReplyRate: ratio(totals.replies, effective),
      duplicateRate: ratio(duplicate, submitted),
      invalidRate: ratio(invalid, submitted),
      d7Sample: d7.totals.newFans,
      d7Orders: d7.totals.orders,
      d7OrderRate: ratio(d7.totals.orders, d7.totals.newFans),
      lowAmount: classified.lowAmount + approvedInvalid.lowAmountCount,
      noWs: classified.noWs + approvedInvalid.noWsCount + importQuantity("NO_NUMBER"),
    };
  }).sort((left, right) => Number(right.rankable) - Number(left.rankable)
    || (right.rechargePerOrderCents ?? -1) - (left.rechargePerOrderCents ?? -1)
    || (right.orderRate ?? -1) - (left.orderRate ?? -1)
    || left.displayName.localeCompare(right.displayName, "zh-CN"));

  const selectedName = scope.normalizedName ? normalizeChannelName(scope.normalizedName) : undefined;
  const selected = selectedName ? grouped.get(selectedName) : undefined;
  const selectedRow = selectedName ? rows.find((row) => row.normalizedName === selectedName) : undefined;
  let selectedChannelDetail: ChannelDetail | null = null;
  if (selected && selectedRow) {
    const uniqueRelated = new Map<string, ChannelDetail["relatedBatches"][number]>();
    for (const event of selected.events) uniqueRelated.set(`${event.batchId}:${event.enteredById}`, { batchId: event.batchId, memberId: event.enteredById, sourceDate: event.batch.sourceDate, groupName: event.batch.group.name });
    selectedChannelDetail = {
      normalizedName: selectedName!,
      displayName: selected.displayName,
      row: selectedRow,
      replyRate: selectedRow.totals.effectiveFans === 0 ? null : selectedRow.totals.replies / selectedRow.totals.effectiveFans,
      rechargePerOrderCents: selectedRow.totals.orders === 0 ? null : selectedRow.totals.rechargeCents / selectedRow.totals.orders,
      d7: windowFor(selected.events, today, 7),
      d14: windowFor(selected.events, today, 14),
      relatedBatches: [...uniqueRelated.values()].sort((left, right) => right.sourceDate.localeCompare(left.sourceDate)),
    };
  }

  return { rows, rankableRows: rows.filter((row) => row.rankable), selectedChannelDetail };
}
