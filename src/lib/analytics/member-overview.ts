import type { EmployeeStageOverride, Role } from "@prisma/client";
import { db } from "../db";
import { resolveEmployeeStage, type EmployeeStage } from "../employee-stage";
import { validateFanBreakdown } from "../validation";
import {
  addBatchTotals,
  calculateBatchTotals,
  emptyBatchTotals,
  type BatchTotals,
  type MetricEvent,
} from "../metrics";
import { getRiskSettings } from "../settings";
import { calculateChannelAdjustedEfficiency, type ChannelAdjustmentState } from "./channel-adjustment";
import { loadCanonicalMetricEvents } from "./canonical-events";
import { hasFunnelAnomaly, getMaturity } from "./metrics";
import { isWithinMaturityWindow } from "./maturity-window";
import { resolveMemberPeriods, type MemberPeriodRange } from "./member-periods";
import { AnalysisAccessError } from "./scope";
import type { AnalysisScope } from "./types";

export type MemberOverviewRow = {
  member: { id: string; name: string; active: boolean; role: "LEAD" | "RECEPTION" };
  group: { id: string; name: string };
  stage: EmployeeStage;
  totals: BatchTotals;
  effectiveRate: number | null;
  orderRate: number | null;
  rechargePerEffectiveFanCents: number | null;
  netPerformanceCents: number;
  adjustedEfficiency: number | null;
  adjustedState: ChannelAdjustmentState | "DATA_INVALID";
  trend: number | null;
};

export type MemberOverviewResult = {
  rows: MemberOverviewRow[];
  summary: {
    effectiveFans: number;
    rechargeCents: number;
    netPerformanceCents: number;
    attentionMemberCount: number;
    matureBatchCount: number;
    observingBatchCount: number;
    rankedMemberCount: number;
  };
};

type BusinessRole = Extract<Role, "RECEPTION">;

type MemberIdentity = {
  id: string;
  name: string;
  active: boolean;
  role: BusinessRole;
  hireDate: string | null;
  stageOverride: EmployeeStageOverride | null;
};

type ChannelTotals = {
  id: string;
  groupId: string;
  normalizedName: string;
  totals: BatchTotals;
};

type OwnerAggregate = {
  member: MemberIdentity;
  group: { id: string; name: string };
  currentChannels: Map<string, ChannelTotals>;
  previousChannels: Map<string, ChannelTotals>;
};

type OwnerPeriodState = {
  totals: BatchTotals;
  dataInvalid: boolean;
};

function emptyResult(): MemberOverviewResult {
  return {
    rows: [],
    summary: {
      effectiveFans: 0,
      rechargeCents: 0,
      netPerformanceCents: 0,
      attentionMemberCount: 0,
      matureBatchCount: 0,
      observingBatchCount: 0,
      rankedMemberCount: 0,
    },
  };
}

function isBusinessRole(role: Role): role is BusinessRole {
  return role === "RECEPTION";
}

function inRange(sourceDate: string, range: MemberPeriodRange): boolean {
  return sourceDate >= range.sourceDateFrom && sourceDate <= range.sourceDateTo;
}

function periodState(channels: Map<string, ChannelTotals>): OwnerPeriodState {
  const totals = emptyBatchTotals();
  for (const channel of channels.values()) addBatchTotals(totals, channel.totals);
  return {
    totals,
    dataInvalid: hasFunnelAnomaly(totals) || !validateFanBreakdown(totals).valid,
  };
}

function netPerformanceCentsOf(channels: Map<string, ChannelTotals>): number {
  let netPerformanceCents = 0;
  for (const channel of channels.values())
    netPerformanceCents += channel.totals.rechargeCents - channel.totals.withdrawalCents;
  return netPerformanceCents;
}

function addEvent(
  channels: Map<string, ChannelTotals>,
  channel: Omit<ChannelTotals, "totals">,
  event: MetricEvent,
) {
  const key = `${channel.groupId}\0${channel.id}`;
  const current = channels.get(key) ?? { ...channel, totals: emptyBatchTotals() };
  addBatchTotals(current.totals, calculateBatchTotals([event]));
  channels.set(key, current);
}

function adjustmentFor(
  owner: OwnerAggregate,
  owners: readonly OwnerAggregate[],
  period: "currentChannels" | "previousChannels",
  states: Map<string, OwnerPeriodState>,
  stages: Map<string, EmployeeStage>,
  minMemberEffectiveFans: number,
) {
  const channels = [...owner[period].values()].map((channel) => ({
    groupId: channel.groupId,
    normalizedName: channel.normalizedName,
    effectiveFans: channel.totals.effectiveFans,
    orders: channel.totals.orders,
    peers: owners.flatMap((peer) => {
      const peerKey = `${peer.group.id}\0${peer.member.id}`;
      if (peer === owner
        || peer.group.id !== owner.group.id
        || !peer.member.active
        || stages.get(peerKey) !== "FORMAL"
        || states.get(peerKey)?.dataInvalid) return [];
      const matching = [...peer[period].values()].filter((value) => value.normalizedName === channel.normalizedName);
      if (matching.length === 0) return [];
      return [{
        memberId: peer.member.id,
        effectiveFans: matching.reduce((sum, value) => sum + value.totals.effectiveFans, 0),
        orders: matching.reduce((sum, value) => sum + value.totals.orders, 0),
      }];
    }),
  }));

  return calculateChannelAdjustedEfficiency({
    memberId: owner.member.id,
    channels,
    minMemberEffectiveFans,
    minPeerEffectiveFans: minMemberEffectiveFans,
  });
}

export async function loadMemberOverview(scope: AnalysisScope, today: string): Promise<MemberOverviewResult> {
  if (scope.role !== "ADMIN" && scope.role !== "RESOURCE_MANAGER" && scope.role !== "COMPANY_MANAGER" && scope.role !== "LEAD") throw new AnalysisAccessError();
  if (scope.requestedForbiddenGroup || scope.groupIds.length === 0) return emptyResult();

  const periods = resolveMemberPeriods({
    period: scope.period,
    sourceDateFrom: scope.sourceDateFrom,
    sourceDateTo: scope.sourceDateTo,
  }, today);
  const queryEnd = periods.period === "custom" ? periods.current.sourceDateTo : today;

  const [people, batches, canonicalEvents, riskSettings] = await Promise.all([
    db.user.findMany({
      where: { groupId: { in: scope.groupIds }, role: "RECEPTION" },
      select: {
        id: true,
        name: true,
        active: true,
        role: true,
        hireDate: true,
        stageOverride: true,
        group: { select: { id: true, name: true } },
      },
    }),
    db.sourceBatch.findMany({
      where: {
        groupId: { in: scope.groupIds },
        ...(scope.channelIds ? { channelId: { in: scope.channelIds } } : {}),
        sourceDate: { gte: periods.previous.sourceDateFrom, lte: queryEnd },
        ...(scope.batchId ? { id: scope.batchId } : {}),
        ...(scope.normalizedName ? { channel: { normalizedName: scope.normalizedName } } : {}),
      },
      select: {
        id: true,
        sourceDate: true,
        group: { select: { id: true, name: true } },
        channel: { select: { id: true, groupId: true, name: true, normalizedName: true } },
      },
    }),
    loadCanonicalMetricEvents({
      groupIds: scope.groupIds,
      channelIds: scope.channelIds,
      sourceDateFrom: periods.previous.sourceDateFrom,
      sourceDateTo: queryEnd,
      normalizedName: scope.normalizedName,
      batchId: scope.batchId,
      occurredOnTo: today,
    }),
    getRiskSettings(),
  ]);

  const eventsByBatch = new Map<string, typeof canonicalEvents>();
  for (const event of canonicalEvents) {
    const current = eventsByBatch.get(event.batchId) ?? [];
    current.push(event);
    eventsByBatch.set(event.batchId, current);
  }

  const owners = new Map<string, OwnerAggregate>();
  for (const person of people) {
    if (!person.group || !isBusinessRole(person.role) || (!scope.includeInactive && !person.active)) continue;
    owners.set(`${person.group.id}\0${person.id}`, {
      member: { ...person, role: person.role },
      group: person.group,
      currentChannels: new Map(),
      previousChannels: new Map(),
    });
  }

  const matureBatches = batches.filter((batch) => inRange(batch.sourceDate, periods.current) && getMaturity(batch.sourceDate, today).d7);
  const observingBatches = batches.filter((batch) => {
    if (getMaturity(batch.sourceDate, today).d7) return false;
    return periods.period === "custom"
      ? inRange(batch.sourceDate, periods.current)
      : batch.sourceDate > periods.current.sourceDateTo && batch.sourceDate <= today;
  });
  for (const batch of batches) {
    const bucket = inRange(batch.sourceDate, periods.current) && getMaturity(batch.sourceDate, today).d7
      ? "currentChannels"
      : inRange(batch.sourceDate, periods.previous) && getMaturity(batch.sourceDate, today).d7
        ? "previousChannels"
        : null;
    if (!bucket) continue;

    for (const event of eventsByBatch.get(batch.id) ?? []) {
      if (!isBusinessRole(event.enteredBy.role)
        || (!scope.includeInactive && !event.enteredBy.active)
        || !isWithinMaturityWindow(batch.sourceDate, event.occurredOn, 7)) continue;
      const key = `${batch.group.id}\0${event.enteredBy.id}`;
      const owner = owners.get(key) ?? {
        member: { ...event.enteredBy, role: event.enteredBy.role },
        group: batch.group,
        currentChannels: new Map(),
        previousChannels: new Map(),
      };
      addEvent(owner[bucket], {
        id: batch.channel.id,
        groupId: batch.channel.groupId,
        normalizedName: batch.channel.normalizedName,
      }, event);
      owners.set(key, owner);
    }
  }

  const allOwners = [...owners.values()];
  const currentStates = new Map<string, OwnerPeriodState>();
  const previousStates = new Map<string, OwnerPeriodState>();
  const stages = new Map<string, EmployeeStage>();
  for (const owner of allOwners) {
    const key = `${owner.group.id}\0${owner.member.id}`;
    currentStates.set(key, periodState(owner.currentChannels));
    previousStates.set(key, periodState(owner.previousChannels));
    stages.set(key, resolveEmployeeStage({
      onDate: today,
      hireDate: owner.member.hireDate,
      override: owner.member.stageOverride,
      trainingDays: riskSettings.trainingDays,
      observationDays: riskSettings.observationDays,
    }).stage);
  }

  const rankable = new Set<string>();
  const rows = allOwners
    .filter((owner) => !scope.memberId || owner.member.id === scope.memberId)
    .map((owner): MemberOverviewRow => {
      const key = `${owner.group.id}\0${owner.member.id}`;
      const currentState = currentStates.get(key)!;
      const netPerformanceCents = netPerformanceCentsOf(owner.currentChannels);
      const currentAdjustment = adjustmentFor(
        owner,
        allOwners,
        "currentChannels",
        currentStates,
        stages,
        riskSettings.efficiencyMinEffectiveFans,
      );
      const previousAdjustment = adjustmentFor(
        owner,
        allOwners,
        "previousChannels",
        previousStates,
        stages,
        riskSettings.efficiencyMinEffectiveFans,
      );
      const adjustedState = currentState.dataInvalid ? "DATA_INVALID" : currentAdjustment.state;
      const adjustedEfficiency = currentState.dataInvalid ? null : currentAdjustment.efficiency;
      const stage = stages.get(key)!;
      if (owner.member.active
        && stage === "FORMAL"
        && !currentState.dataInvalid
        && currentAdjustment.state === "READY") rankable.add(key);

      return {
        member: {
          id: owner.member.id,
          name: owner.member.name,
          active: owner.member.active,
          role: owner.member.role,
        },
        group: owner.group,
        stage,
        totals: currentState.totals,
        effectiveRate: currentState.totals.newFans === 0 ? null : currentState.totals.effectiveFans / currentState.totals.newFans,
        orderRate: currentState.totals.registration === 0 ? null : currentState.totals.orders / currentState.totals.registration,
        rechargePerEffectiveFanCents: currentState.totals.effectiveFans === 0 ? null : currentState.totals.rechargeCents / currentState.totals.effectiveFans,
        netPerformanceCents,
        adjustedEfficiency,
        adjustedState,
        trend: adjustedState === "READY" && previousAdjustment.state === "READY"
          ? adjustedEfficiency! - previousAdjustment.efficiency!
          : null,
      };
    })
    .sort((left, right) => {
      const leftRanked = rankable.has(`${left.group.id}\0${left.member.id}`);
      const rightRanked = rankable.has(`${right.group.id}\0${right.member.id}`);
      return Number(rightRanked) - Number(leftRanked)
        || right.netPerformanceCents - left.netPerformanceCents
        || left.member.name.localeCompare(right.member.name, "zh-CN");
    });

  const totals = rows.reduce((sum, row) => addBatchTotals(sum, row.totals), emptyBatchTotals());
  const rankedRows = rows.filter((row) => rankable.has(`${row.group.id}\0${row.member.id}`));
  return {
    rows,
    summary: {
      effectiveFans: totals.effectiveFans,
      rechargeCents: totals.rechargeCents,
      netPerformanceCents: rows.reduce((sum, row) => sum + row.netPerformanceCents, 0),
      attentionMemberCount: rankedRows.filter((row) => row.adjustedEfficiency! < riskSettings.coachingEfficiency).length,
      matureBatchCount: matureBatches.length,
      observingBatchCount: observingBatches.length,
      rankedMemberCount: rankedRows.length,
    },
  };
}
