import type { EmployeeStageOverride, MetricKind, Role } from "@prisma/client";
import { db } from "../db";
import { resolveEmployeeStage, type EmployeeStage } from "../employee-stage";
import { validateFanBreakdown } from "../finance";
import {
  addBatchTotals,
  calculateBatchTotals,
  emptyBatchTotals,
  type BatchTotals,
  type MetricEvent,
} from "../metrics";
import type { PermissionUser } from "../permissions";
import { getRiskSettings } from "../settings";
import { calculateChannelAdjustedEfficiency } from "./channel-adjustment";
import { loadCanonicalMetricEvents } from "./canonical-events";
import { evaluateDataRisks, evaluateFinancialRisks } from "./data-risk";
import { getLargestDrop, hasFunnelAnomaly } from "./metrics";
import { addCalendarDays, isWithinMaturityWindow } from "./maturity-window";
import { loadMemberOverview, type MemberOverviewRow } from "./member-overview";
import { resolveMemberPeriods, type MemberPeriodRange } from "./member-periods";
import {
  evaluatePerformanceRisk,
  generateEvaluationDates,
  type DailyEvaluation,
} from "./risk-evaluation";
import type { AnalysisScope } from "./types";

type BusinessRole = Extract<Role, "LEAD" | "RECEPTION">;

type EvidenceEvent = {
  kind: MetricKind;
  quantity: number | null;
  amountCents: number | null;
  occurredOn: string;
  enteredById: string;
};

type EvidenceBatch = {
  id: string;
  sourceDate: string;
  channel: {
    id: string;
    groupId: string;
    name: string;
    normalizedName: string;
  };
  events: EvidenceEvent[];
};

type EvidencePerson = {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  hireDate: string | null;
  stageOverride: EmployeeStageOverride | null;
};

type ChannelEvidence = {
  channel: { id: string; groupId: string; name: string; normalizedName: string };
  totals: BatchTotals;
};

type PeriodEvidence = {
  totals: BatchTotals;
  channels: ChannelEvidence[];
  dataValid: boolean;
};

export type MemberEvidenceResult = {
  member: {
    id: string;
    name: string;
    role: BusinessRole;
    active: boolean;
    group: { id: string; name: string };
    stage: EmployeeStage;
    employmentDay: number | null;
    stageSource: "AUTO" | "OVERRIDE";
  };
  funnel: BatchTotals;
  channels: ChannelEvidence[];
  financialFormula: {
    effectiveFans: number;
    rechargeCents: number;
    channelPerformanceCents: number;
    withdrawalCents: number;
    netPerformanceCents: number;
  };
  trend: {
    current: { totals: BatchTotals; adjustedEfficiency: number | null; netPerformanceCents: number };
    previous: { totals: BatchTotals; adjustedEfficiency: number | null; netPerformanceCents: number };
    adjustedEfficiencyChange: number | null;
    netPerformanceChangeCents: number | null;
  };
  largestDrop: ReturnType<typeof getLargestDrop>;
  evaluations: DailyEvaluation[];
  risks: {
    performance: ReturnType<typeof evaluatePerformanceRisk>;
    financial: ReturnType<typeof evaluateFinancialRisks>;
    data: ReturnType<typeof evaluateDataRisks>;
  };
  matureBatches: Array<{
    id: string;
    sourceDate: string;
    channel: { id: string; groupId: string; name: string };
    totals: BatchTotals;
    maturity: "MATURE";
  }>;
  latestDecision: {
    id: string;
    level: "LIMIT_WATCH" | "ELIMINATION_WATCH";
    evidenceThrough: string;
    reason: string;
    createdAt: Date;
    actor: { id: string; name: string };
  } | null;
};

export class MemberEvidenceAccessError extends Error {
  constructor() {
    super("无权查看该成员");
    this.name = "MemberEvidenceAccessError";
  }
}

function isBusinessRole(role: Role): role is BusinessRole {
  return role === "RECEPTION";
}

function daysBetween(later: string, earlier: string): number {
  return Math.round((Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86_400_000);
}

function inRange(sourceDate: string, range: MemberPeriodRange): boolean {
  return sourceDate >= range.sourceDateFrom && sourceDate <= range.sourceDateTo;
}

function eventMetric(event: EvidenceEvent): MetricEvent {
  return { kind: event.kind, quantity: event.quantity, amountCents: event.amountCents };
}

function relevantEvents(batch: EvidenceBatch, memberId: string, evaluationDate: string): EvidenceEvent[] {
  return batch.events.filter((event) => event.enteredById === memberId
    && event.occurredOn <= evaluationDate
    && isWithinMaturityWindow(batch.sourceDate, event.occurredOn, 7));
}

function aggregatePeriod(
  batches: readonly EvidenceBatch[],
  memberId: string,
  range: MemberPeriodRange,
  evaluationDate: string,
): PeriodEvidence {
  const byChannel = new Map<string, ChannelEvidence>();
  for (const batch of batches) {
    if (!inRange(batch.sourceDate, range) || batch.sourceDate > addCalendarDays(evaluationDate, -7)) continue;
    const events = relevantEvents(batch, memberId, evaluationDate);
    if (events.length === 0) continue;
    const key = `${batch.channel.groupId}\0${batch.channel.id}`;
    const current = byChannel.get(key) ?? {
      channel: {
        id: batch.channel.id,
        groupId: batch.channel.groupId,
        name: batch.channel.name,
        normalizedName: batch.channel.normalizedName,
      },
      totals: emptyBatchTotals(),
    };
    addBatchTotals(current.totals, calculateBatchTotals(events.map(eventMetric)));
    byChannel.set(key, current);
  }

  const totals = emptyBatchTotals();
  const channels = [...byChannel.values()];
  for (const channel of channels) addBatchTotals(totals, channel.totals);
  return {
    totals,
    channels: channels.sort((left, right) => left.channel.name.localeCompare(right.channel.name, "zh-CN")),
    dataValid: !hasFunnelAnomaly(totals) && validateFanBreakdown(totals).valid,
  };
}

function overviewScope(
  actor: PermissionUser,
  groupId: string,
  memberId: string,
  period: "mature7" | "custom",
  range?: MemberPeriodRange,
): AnalysisScope {
  return {
    actorId: actor.id,
    role: actor.role as "ADMIN" | "LEAD",
    groupIds: [groupId],
    requestedForbiddenGroup: false,
    groupId,
    memberId,
    period,
    sourceDateFrom: range?.sourceDateFrom ?? "",
    sourceDateTo: range?.sourceDateTo ?? "",
    includeInactive: true,
    showInsufficient: true,
  };
}

function overviewRow(rows: readonly MemberOverviewRow[], memberId: string): MemberOverviewRow {
  const row = rows.find((candidate) => candidate.member.id === memberId);
  if (!row) throw new MemberEvidenceAccessError();
  return row;
}

function ownerWindowState(input: {
  person: EvidencePerson;
  people: readonly EvidencePerson[];
  batches: readonly EvidenceBatch[];
  evaluationDate: string;
  minEffectiveFans: number;
  trainingDays: number;
  observationDays: number;
}) {
  const sourceDateTo = addCalendarDays(input.evaluationDate, -7);
  const range = {
    sourceDateFrom: addCalendarDays(sourceDateTo, -6),
    sourceDateTo,
    sourceDayCount: 7,
  };
  const states = new Map<string, PeriodEvidence>();
  for (const person of input.people) {
    if (!isBusinessRole(person.role)) continue;
    states.set(person.id, aggregatePeriod(input.batches, person.id, range, input.evaluationDate));
  }
  const target = states.get(input.person.id) ?? { totals: emptyBatchTotals(), channels: [], dataValid: true };
  const adjustment = calculateChannelAdjustedEfficiency({
    memberId: input.person.id,
    minMemberEffectiveFans: input.minEffectiveFans,
    minPeerEffectiveFans: input.minEffectiveFans,
    channels: target.channels.map((channel) => ({
      groupId: channel.channel.groupId,
      normalizedName: channel.channel.normalizedName,
      effectiveFans: channel.totals.effectiveFans,
      orders: channel.totals.orders,
      peers: input.people.flatMap((peer) => {
        if (peer.id === input.person.id || !peer.active || !isBusinessRole(peer.role)) return [];
        const peerStage = resolveEmployeeStage({
          onDate: input.evaluationDate,
          hireDate: peer.hireDate,
          override: peer.stageOverride,
          trainingDays: input.trainingDays,
          observationDays: input.observationDays,
        }).stage;
        const peerState = states.get(peer.id);
        if (peerStage !== "FORMAL" || !peerState?.dataValid) return [];
        const matching = peerState.channels.filter((candidate) => candidate.channel.normalizedName === channel.channel.normalizedName);
        if (matching.length === 0) return [];
        return [{
          memberId: peer.id,
          effectiveFans: matching.reduce((sum, candidate) => sum + candidate.totals.effectiveFans, 0),
          orders: matching.reduce((sum, candidate) => sum + candidate.totals.orders, 0),
        }];
      }),
    })),
  });
  return { target, adjustment };
}

function dailyEvaluations(input: {
  person: EvidencePerson;
  people: readonly EvidencePerson[];
  batches: readonly EvidenceBatch[];
  confirmationDates: ReadonlySet<string>;
  historyEditDates: readonly string[];
  today: string;
  coachingEfficiency: number;
  minEffectiveFans: number;
  trainingDays: number;
  observationDays: number;
}): DailyEvaluation[] {
  const targetSourceDates = input.batches.flatMap((batch) =>
    batch.events.some((event) => event.enteredById === input.person.id) ? [batch.sourceDate] : [],
  ).sort();
  const firstEvaluationDate = targetSourceDates[0] ? addCalendarDays(targetSourceDates[0], 7) : input.today;
  const dates = firstEvaluationDate <= input.today
    ? generateEvaluationDates(firstEvaluationDate, input.today)
    : [input.today];

  return dates.map((evaluationDate): DailyEvaluation => {
    const { target, adjustment } = ownerWindowState({
      person: input.person,
      people: input.people,
      batches: input.batches,
      evaluationDate,
      minEffectiveFans: input.minEffectiveFans,
      trainingDays: input.trainingDays,
      observationDays: input.observationDays,
    });
    if (target.channels.length === 0) {
      return { evaluationDate, eligible: false, efficiency: null, state: "OBSERVING", reason: "IMMATURE" };
    }
    if (!target.dataValid) {
      return { evaluationDate, eligible: false, efficiency: null, state: "OBSERVING", reason: "DATA_INVALID" };
    }

    const lastRecord = input.batches.flatMap((batch) => batch.events
      .filter((event) => event.enteredById === input.person.id && event.occurredOn <= evaluationDate)
      .map((event) => event.occurredOn))
      .sort()
      .at(-1) ?? null;
    const hasFrequentHistoryEdits = input.historyEditDates.filter((date) =>
      date <= evaluationDate && date >= addCalendarDays(evaluationDate, -29),
    ).length >= 3;
    if (!input.confirmationDates.has(evaluationDate)
      || lastRecord === null
      || daysBetween(evaluationDate, lastRecord) >= 7
      || hasFrequentHistoryEdits) {
      return { evaluationDate, eligible: false, efficiency: null, state: "OBSERVING", reason: "DATA_INVALID" };
    }
    if (adjustment.state !== "READY" || adjustment.efficiency === null) {
      return { evaluationDate, eligible: false, efficiency: null, state: "OBSERVING", reason: "INSUFFICIENT_SAMPLE" };
    }
    return {
      evaluationDate,
      eligible: true,
      efficiency: adjustment.efficiency,
      state: adjustment.efficiency < input.coachingEfficiency ? "LOW" : "OK",
      reason: "READY",
    };
  });
}

export async function loadMemberEvidence(
  actor: PermissionUser,
  memberId: string,
  today: string,
): Promise<MemberEvidenceResult> {
  if (!actor.active || (actor.role !== "ADMIN" && actor.role !== "LEAD"))
    throw new MemberEvidenceAccessError();

  const target = await db.user.findFirst({
    where: {
      id: memberId,
      role: "RECEPTION",
      groupId: actor.role === "LEAD" ? actor.groupId ?? "" : { not: null },
    },
    select: {
      id: true,
      name: true,
      role: true,
      active: true,
      hireDate: true,
      stageOverride: true,
      group: { select: { id: true, name: true } },
    },
  });
  if (!target?.group || !isBusinessRole(target.role)) throw new MemberEvidenceAccessError();

  const periods = resolveMemberPeriods({ period: "mature7" }, today);
  const [currentOverview, previousOverview, people, rawBatches, canonicalEvents, confirmations, historyAudits, latestDecision, riskSettings] = await Promise.all([
    loadMemberOverview(overviewScope(actor, target.group.id, target.id, "mature7"), today),
    loadMemberOverview(overviewScope(actor, target.group.id, target.id, "custom", periods.previous), today),
    db.user.findMany({
      where: { groupId: target.group.id, role: "RECEPTION" },
      select: { id: true, name: true, role: true, active: true, hireDate: true, stageOverride: true },
    }),
    db.sourceBatch.findMany({
      where: { groupId: target.group.id, sourceDate: { lte: today } },
      select: {
        id: true,
        sourceDate: true,
        channel: { select: { id: true, groupId: true, name: true, normalizedName: true } },
      },
    }),
    loadCanonicalMetricEvents({
      groupIds: [target.group.id],
      sourceDateTo: today,
      occurredOnTo: today,
    }),
    db.dailyEntryConfirmation.findMany({
      where: { userId: target.id, businessDate: { lte: today } },
      select: { businessDate: true },
    }),
    db.auditLog.findMany({
      where: { actorId: target.id, action: "HISTORY_GROUP_UPDATED" },
      select: { createdAt: true },
    }),
    db.riskDecision.findFirst({
      where: { memberId: target.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        level: true,
        evidenceThrough: true,
        reason: true,
        createdAt: true,
        actor: { select: { id: true, name: true } },
      },
    }),
    getRiskSettings(),
  ]);

  const eventsByBatch = new Map<string, EvidenceEvent[]>();
  for (const event of canonicalEvents) {
    const current = eventsByBatch.get(event.batchId) ?? [];
    current.push({
      kind: event.kind,
      quantity: event.quantity,
      amountCents: event.amountCents,
      occurredOn: event.occurredOn,
      enteredById: event.enteredById,
    });
    eventsByBatch.set(event.batchId, current);
  }
  const batches: EvidenceBatch[] = rawBatches.map((batch) => ({
    ...batch,
    events: eventsByBatch.get(batch.id) ?? [],
  }));

  const currentRow = overviewRow(currentOverview.rows, target.id);
  const previousRow = overviewRow(previousOverview.rows, target.id);
  const current = aggregatePeriod(batches, target.id, periods.current, today);
  const previous = aggregatePeriod(batches, target.id, periods.previous, today);
  const stage = resolveEmployeeStage({
    onDate: today,
    hireDate: target.hireDate,
    override: target.stageOverride,
    trainingDays: riskSettings.trainingDays,
    observationDays: riskSettings.observationDays,
  });
  const historyEditDates = historyAudits.map((audit) => audit.createdAt.toISOString().slice(0, 10));
  const evaluations = dailyEvaluations({
    person: target,
    people,
    batches,
    confirmationDates: new Set(confirmations.map((confirmation) => confirmation.businessDate)),
    historyEditDates,
    today,
    coachingEfficiency: riskSettings.coachingEfficiency,
    minEffectiveFans: riskSettings.efficiencyMinEffectiveFans,
    trainingDays: riskSettings.trainingDays,
    observationDays: riskSettings.observationDays,
  });

  const targetRecordDates = batches.flatMap((batch) => batch.events
    .filter((event) => event.enteredById === target.id)
    .map((event) => event.occurredOn)).sort();
  const lastRecordDate = targetRecordDates.at(-1) ?? null;
  const dataRisks = evaluateDataRisks({
    evaluationDate: today,
    confirmed: confirmations.some((confirmation) => confirmation.businessDate === today),
    daysSinceLastRecord: lastRecordDate ? daysBetween(today, lastRecordDate) : null,
    longNoRecordDays: 7,
    totals: current.totals,
    historyModificationCount: historyEditDates.filter((date) => date >= addCalendarDays(today, -29) && date <= today).length,
    frequentModificationCount: 3,
  });
  const financialRisks = evaluateFinancialRisks({
    current: {
      dataValid: current.dataValid && dataRisks.length === 0,
      rechargeCents: current.totals.rechargeCents,
      channelPerformanceCents: current.totals.channelPerformanceCents,
      withdrawalCents: current.totals.withdrawalCents,
    },
    previous: {
      dataValid: previous.dataValid,
      rechargeCents: previous.totals.rechargeCents,
      channelPerformanceCents: previous.totals.channelPerformanceCents,
      withdrawalCents: previous.totals.withdrawalCents,
    },
  });
  const performanceRisk = evaluatePerformanceRisk({ evaluations, stage: stage.stage, rules: riskSettings, today });

  return {
    member: {
      id: target.id,
      name: target.name,
      role: target.role,
      active: target.active,
      group: target.group,
      stage: stage.stage,
      employmentDay: stage.employmentDay,
      stageSource: stage.source,
    },
    funnel: current.totals,
    channels: current.channels,
    financialFormula: {
      effectiveFans: current.totals.effectiveFans,
      rechargeCents: current.totals.rechargeCents,
      channelPerformanceCents: current.totals.channelPerformanceCents,
      withdrawalCents: current.totals.withdrawalCents,
      netPerformanceCents: currentRow.netPerformanceCents,
    },
    trend: {
      current: { totals: current.totals, adjustedEfficiency: currentRow.adjustedEfficiency, netPerformanceCents: currentRow.netPerformanceCents },
      previous: { totals: previous.totals, adjustedEfficiency: previousRow.adjustedEfficiency, netPerformanceCents: previousRow.netPerformanceCents },
      adjustedEfficiencyChange: currentRow.trend,
      netPerformanceChangeCents: currentRow.netPerformanceCents - previousRow.netPerformanceCents,
    },
    largestDrop: getLargestDrop(current.totals),
    evaluations,
    risks: { performance: performanceRisk, financial: financialRisks, data: dataRisks },
    matureBatches: batches.flatMap((batch) => {
      if (!inRange(batch.sourceDate, periods.current) || batch.sourceDate > addCalendarDays(today, -7)) return [];
      const events = relevantEvents(batch, target.id, today);
      if (events.length === 0) return [];
      return [{
        id: batch.id,
        sourceDate: batch.sourceDate,
        channel: { id: batch.channel.id, groupId: batch.channel.groupId, name: batch.channel.name },
        totals: calculateBatchTotals(events.map(eventMetric)),
        maturity: "MATURE" as const,
      }];
    }).sort((left, right) => right.sourceDate.localeCompare(left.sourceDate) || left.channel.name.localeCompare(right.channel.name, "zh-CN")),
    latestDecision,
  };
}
