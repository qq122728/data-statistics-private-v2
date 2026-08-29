import { db } from "../db";
import { addBatchTotals, calculateBatchTotals, calculateConversionRates, emptyBatchTotals, type BatchTotals, type ConversionRates, type MetricEvent } from "../metrics";
import { getLargestDrop, getMaturity, getSampleState } from "./metrics";
import type { AnalysisScope } from "./types";
import { loadCanonicalMetricEvents } from "./canonical-events";
import { getApprovedInvalidFanTotals, type ApprovedInvalidFanReportTotal } from "../invalid-fan-reports";

export type MemberPerformanceRow = {
  userId: string;
  name: string;
  role: "LEAD" | "RECEPTION";
  groupId: string;
  groupName: string;
  active: boolean;
  totals: BatchTotals;
  rates: ConversionRates;
  sampleState: "RANKABLE" | "INSUFFICIENT";
  matureNewFans: number;
};

export type GroupPerformanceRow = {
  groupId: string;
  groupName: string;
  departmentId?: string;
  departmentName?: string;
  activePeople: number;
  totals: BatchTotals;
  rates: ConversionRates;
  matureNewFans: number;
  sampleState: "RANKABLE" | "INSUFFICIENT";
  averageOrders: number | null;
};

export type MemberPerformanceDetail = {
  row: MemberPerformanceRow;
  largestDrop: ReturnType<typeof getLargestDrop> | null;
  trend: Array<{ occurredOn: string; newFans: number; orders: number; rechargeCents: number }>;
  channelComposition: Array<{ normalizedName: string; displayName: string; newFans: number; orders: number; rechargeCents: number }>;
  relatedBatches: Array<{ batchId: string; sourceDate: string; normalizedName: string; channelName: string }>;
};

export type TeamDailyRow = {
  key: string;
  occurredOn: string;
  groupId: string;
  groupName: string;
  departmentName?: string;
  totals: BatchTotals;
  lowAmount: number;
  noWs: number;
};

function buildDailyRows(events: Awaited<ReturnType<typeof loadCanonicalMetricEvents>>, reports: ApprovedInvalidFanReportTotal[]): TeamDailyRow[] {
  const rows = new Map<string, TeamDailyRow>();
  for (const event of events) {
    const key = `${event.occurredOn}:${event.batch.group.id}`;
    const current = rows.get(key) ?? {
      key,
      occurredOn: event.occurredOn,
      groupId: event.batch.group.id,
      groupName: event.batch.group.name,
      totals: emptyBatchTotals(),
      lowAmount: 0,
      noWs: 0,
    };
    addBatchTotals(current.totals, calculateBatchTotals([event]));
    if (event.kind === "NO_NUMBER") current.noWs += event.quantity ?? 0;
    if (event.kind === "NEW_FANS") {
      if (event.receptionCategory === "LOW_AMOUNT") current.lowAmount += event.quantity ?? 0;
      if (event.receptionCategory === "NO_WS") current.noWs += event.quantity ?? 0;
    }
    rows.set(key, current);
  }
  for (const report of reports) {
    const key = `${report.sourceDate}:${report.groupId}`;
    const current = rows.get(key) ?? {
      key,
      occurredOn: report.sourceDate,
      groupId: report.groupId,
      groupName: report.groupName,
      totals: emptyBatchTotals(),
      lowAmount: 0,
      noWs: 0,
    };
    current.totals.newFans += report.total;
    current.totals.duplicateFans += report.collisionCount;
    current.lowAmount += report.lowAmountCount;
    current.noWs += report.noWsCount;
    rows.set(key, current);
  }
  return [...rows.values()].sort((left, right) => right.occurredOn.localeCompare(left.occurredOn) || left.groupName.localeCompare(right.groupName, "zh-CN"));
}

type GroupBusinessPeriod = { today: string; from: string; to: string };

export async function loadTeamPerformance(scope: AnalysisScope, today: string, options?: { groupPeriods?: Record<string, GroupBusinessPeriod> }) {
  if (scope.requestedForbiddenGroup || scope.groupIds.length === 0) return { groupRows: [] as GroupPerformanceRow[], memberRows: [] as MemberPerformanceRow[], dailyRows: [] as TeamDailyRow[], selectedMemberDetail: null as MemberPerformanceDetail | null };

  const groupPeriod = (groupId: string): GroupBusinessPeriod => options?.groupPeriods?.[groupId] ?? { today, from: scope.sourceDateFrom, to: scope.sourceDateTo };
  const periods = scope.groupIds.map(groupPeriod);
  const minimum = (values: string[]) => values.filter(Boolean).sort()[0] || undefined;
  const maximum = (values: string[]) => values.filter(Boolean).sort().at(-1) || undefined;
  const sourceDateFrom = minimum(periods.map((period) => period.from));
  const sourceDateTo = maximum(periods.map((period) => period.to));
  const occurredOnTo = maximum(periods.map((period) => period.today)) ?? today;

  const [groups, currentPeople, rawEvents, rawDailyEvents, rawApprovedInvalidReports] = await Promise.all([
    db.teamGroup.findMany({
      where: { id: { in: scope.groupIds } },
      select: { id: true, name: true, department: { select: { id: true, name: true } } },
    }),
    db.user.findMany({
      where: { groupId: { in: scope.groupIds }, role: "RECEPTION", ...(scope.includeInactive ? {} : { active: true }) },
      select: { id: true, name: true, role: true, active: true, group: { select: { id: true, name: true } } },
    }),
    loadCanonicalMetricEvents({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom,
      sourceDateTo,
      normalizedName: scope.normalizedName,
      occurredOnTo,
    }),
    loadCanonicalMetricEvents({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      normalizedName: scope.normalizedName,
      occurredOnFrom: sourceDateFrom,
      occurredOnTo: sourceDateTo,
    }),
    getApprovedInvalidFanTotals({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom,
      sourceDateTo,
      normalizedChannelName: scope.normalizedName,
    }),
  ]);

  const inSourcePeriod = (groupId: string, date: string) => {
    const period = groupPeriod(groupId);
    return (!period.from || date >= period.from) && (!period.to || date <= period.to);
  };
  const events = rawEvents.filter((event) => inSourcePeriod(event.batch.group.id, event.batch.sourceDate) && event.occurredOn <= groupPeriod(event.batch.group.id).today);
  const dailyEvents = rawDailyEvents.filter((event) => inSourcePeriod(event.batch.group.id, event.occurredOn));
  const approvedInvalidReports = rawApprovedInvalidReports.filter((report) => inSourcePeriod(report.groupId, report.sourceDate));

  type PerformanceEvent = (typeof events)[number];
  type OwnerGroup = {
    person: { id: string; name: string; role: "RECEPTION"; active: boolean };
    group: { id: string; name: string };
    events: PerformanceEvent[];
  };
  const owners = new Map<string, OwnerGroup>();
  for (const person of currentPeople) {
    if (!person.group || person.role !== "RECEPTION") continue;
    owners.set(`${person.group.id}:${person.id}`, { person: { ...person, role: person.role }, group: person.group, events: [] });
  }
  for (const event of events) {
    const key = `${event.batch.group.id}:${event.enteredBy.id}`;
    const owner = owners.get(key) ?? { person: { ...event.enteredBy, role: event.enteredBy.role }, group: event.batch.group, events: [] };
    owner.events.push(event);
    owners.set(key, owner);
  }

  const details = new Map<string, MemberPerformanceDetail>();
  const eventsByRow = new Map<string, PerformanceEvent[]>();
  const reportsByReception = new Map<string, ApprovedInvalidFanReportTotal[]>();
  for (const report of approvedInvalidReports) {
    const reportKey = `${report.groupId}:${report.reporterId}`;
    const current = reportsByReception.get(reportKey) ?? [];
    current.push(report);
    reportsByReception.set(reportKey, current);
  }
  const allMemberRows: MemberPerformanceRow[] = [...owners.values()].map(({ person, group, events: personEvents }) => {
    const totals = calculateBatchTotals(personEvents);
    const businessToday = groupPeriod(group.id).today;
    const matureEvents = personEvents.filter((event) => getMaturity(event.batch.sourceDate, businessToday).d7);
    const matureTotals = calculateBatchTotals(matureEvents);
    const personReports = reportsByReception.get(`${group.id}:${person.id}`) ?? [];
    for (const report of personReports) {
      totals.newFans += report.total;
      totals.duplicateFans += report.collisionCount;
      if (getMaturity(report.sourceDate, businessToday).d7) {
        matureTotals.newFans += report.total;
        matureTotals.duplicateFans += report.collisionCount;
      }
    }
    const row: MemberPerformanceRow = {
      userId: person.id,
      name: person.name,
      role: person.role,
      groupId: group.id,
      groupName: group.name,
      active: person.active,
      totals,
      rates: calculateConversionRates(matureTotals),
      sampleState: getSampleState(matureTotals.newFans),
      matureNewFans: matureTotals.newFans,
    };

    const trend = new Map<string, { newFans: number; orders: number; rechargeCents: number }>();
    const channelComposition = new Map<string, { normalizedName: string; displayName: string; events: MetricEvent[] }>();
    const relatedBatches = new Map<string, { batchId: string; sourceDate: string; normalizedName: string; channelName: string }>();
    for (const event of personEvents) {
      const point = trend.get(event.occurredOn) ?? { newFans: 0, orders: 0, rechargeCents: 0 };
      if (event.kind === "NEW_FANS") point.newFans += event.quantity ?? 0;
      if (event.kind === "ORDER") point.orders += event.quantity ?? 0;
      if (event.kind === "RECHARGE") point.rechargeCents += event.amountCents ?? 0;
      trend.set(event.occurredOn, point);
      const channel = channelComposition.get(event.batch.channel.normalizedName) ?? { normalizedName: event.batch.channel.normalizedName, displayName: event.batch.channel.name, events: [] };
      channel.events.push(event);
      channelComposition.set(channel.normalizedName, channel);
      relatedBatches.set(event.batchId, { batchId: event.batchId, sourceDate: event.batch.sourceDate, normalizedName: event.batch.channel.normalizedName, channelName: event.batch.channel.name });
    }
    const detail = {
      row,
      largestDrop: personEvents.length ? getLargestDrop(totals) : null,
      trend: [...trend.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([occurredOn, point]) => ({ occurredOn, ...point })),
      channelComposition: [...channelComposition.values()].map((channel) => ({ ...channel, ...calculateBatchTotals(channel.events), events: undefined })).map(({ normalizedName, displayName, newFans, orders, rechargeCents }) => ({ normalizedName, displayName, newFans, orders, rechargeCents })).sort((left, right) => right.rechargeCents - left.rechargeCents || left.displayName.localeCompare(right.displayName, "zh-CN")),
      relatedBatches: [...relatedBatches.values()].sort((left, right) => right.sourceDate.localeCompare(left.sourceDate)),
    };
    details.set(`${group.id}:${person.id}`, detail);
    eventsByRow.set(`${group.id}:${person.id}`, personEvents);
    return row;
  }).sort((left, right) => right.totals.rechargeCents - left.totals.rechargeCents || right.totals.orders - left.totals.orders || right.totals.newFans - left.totals.newFans || left.name.localeCompare(right.name, "zh-CN"));

  const groupMap = new Map<string, { groupId: string; groupName: string; departmentId: string; departmentName: string; activePeople: number; totals: BatchTotals; matureTotals: BatchTotals }>();
  for (const group of groups) groupMap.set(group.id, {
    groupId: group.id,
    groupName: group.name,
    departmentId: group.department.id,
    departmentName: group.department.name,
    activePeople: currentPeople.filter((person) => person.active && person.group?.id === group.id).length,
    totals: emptyBatchTotals(),
    matureTotals: emptyBatchTotals(),
  });
  for (const row of allMemberRows) {
    const current = groupMap.get(row.groupId);
    if (!current) continue;
    addBatchTotals(current.totals, row.totals);
    const personEvents = eventsByRow.get(`${row.groupId}:${row.userId}`) ?? [];
    addBatchTotals(current.matureTotals, calculateBatchTotals(personEvents.filter((event) => getMaturity(event.batch.sourceDate, groupPeriod(row.groupId).today).d7)));
    groupMap.set(row.groupId, current);
  }
  const groupRows = [...groupMap.values()].map(({ matureTotals, ...group }) => ({
    ...group,
    rates: calculateConversionRates(matureTotals),
    matureNewFans: matureTotals.newFans,
    sampleState: getSampleState(matureTotals.newFans),
    averageOrders: group.activePeople === 0 ? null : group.totals.orders / group.activePeople,
  })).sort((left, right) => right.totals.rechargeCents - left.totals.rechargeCents || right.totals.orders - left.totals.orders || left.groupName.localeCompare(right.groupName, "zh-CN"));

  const memberRows = scope.includeInactive ? allMemberRows : allMemberRows.filter((row) => row.active);
  const selectedDetail = scope.memberId
    ? scope.groupId
      ? details.get(`${scope.groupId}:${scope.memberId}`) ?? null
      : [...details.values()].find((detail) => detail.row.userId === scope.memberId) ?? null
    : null;

  return {
    groupRows,
    memberRows,
    dailyRows: buildDailyRows(dailyEvents, approvedInvalidReports),
    selectedMemberDetail: selectedDetail && (scope.includeInactive || selectedDetail.row.active) ? selectedDetail : null,
  };
}
