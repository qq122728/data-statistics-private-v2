import { createHash } from "node:crypto";
import { compareHistoryGroups } from "./history-group-order";
import type { MetricKind } from "./metrics";

export const historyMetricFields = [
  "newFans", "effectiveFans", "noNumber", "duplicateFans",
  "replies", "groupJoin", "groupLeave", "expertIntro",
  "registration", "order", "rechargeCents",
  "withdrawalCents", "channelPerformanceCents",
] as const;

export type HistoryMetricTotals = Record<(typeof historyMetricFields)[number], number>;

export type HistoryGroup = {
  key: string;
  occurredOn: string;
  batchId: string;
  sourceDate: string;
  fingerprint: string;
  eventIds: string[];
  editable: boolean;
  metrics: HistoryMetricTotals;
  batch: { id: string; group: { id: string; name: string; active: boolean }; channel: { id: string; name: string; normalizedName?: string; active: boolean } };
  enteredBy: { id: string; name: string; active: boolean };
};

export type HistoryLeadCount = {
  ownerId: string;
  batchId: string;
  invalid: boolean;
};

export type HistoryGroupEvent = {
  id: string;
  occurredOn: string;
  kind: MetricKind;
  quantity: number | null;
  amountCents: number | null;
  derivedFromLedger?: boolean;
  batch: {
    id: string;
    sourceDate: string;
    group: { id: string; name: string; active: boolean };
    channel: { id: string; name: string; normalizedName?: string; active: boolean };
  };
  enteredBy: { id: string; name: string; active: boolean };
};

const fieldForKind: Partial<Record<MetricKind, (typeof historyMetricFields)[number]>> = {
  NEW_FANS: "newFans",
  EFFECTIVE_FANS: "effectiveFans",
  NO_NUMBER: "noNumber",
  DUPLICATE_FANS: "duplicateFans",
  REPLIES: "replies",
  GROUP_JOIN: "groupJoin",
  GROUP_LEAVE: "groupLeave",
  EXPERT_INTRO: "expertIntro",
  REGISTRATION: "registration",
  ORDER: "order",
  RECHARGE: "rechargeCents",
  WITHDRAWAL: "withdrawalCents",
  CHANNEL_PERFORMANCE: "channelPerformanceCents",
};

function emptyMetrics(): HistoryMetricTotals {
  return {
    newFans: 0,
    effectiveFans: 0,
    noNumber: 0,
    duplicateFans: 0,
    replies: 0,
    groupJoin: 0,
    groupLeave: 0,
    expertIntro: 0,
    registration: 0,
    order: 0,
    rechargeCents: 0,
    withdrawalCents: 0,
    channelPerformanceCents: 0,
  };
}

export function buildHistoryGroupFingerprint(events: readonly HistoryGroupEvent[]): string {
  const tuples = [...events]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((event) => [
      event.id,
      event.batch.id,
      event.enteredBy.id,
      event.occurredOn,
      event.kind,
      event.quantity,
      event.amountCents,
    ]);

  return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
}

export function groupHistoryEvents(events: readonly HistoryGroupEvent[]): HistoryGroup[] {
  const eventsByKey = new Map<string, HistoryGroupEvent[]>();

  for (const event of events) {
    const key = `${event.enteredBy.id}::${event.occurredOn}::${event.batch.id}`;
    const groupedEvents = eventsByKey.get(key) ?? [];
    groupedEvents.push(event);
    eventsByKey.set(key, groupedEvents);
  }

  return [...eventsByKey.entries()]
    .map(([key, groupedEvents]) => {
      const firstEvent = groupedEvents[0];
      const metrics = emptyMetrics();

      for (const event of groupedEvents) {
        const field = fieldForKind[event.kind];
        if (!field) continue;
        metrics[field] += event.kind === "RECHARGE" || event.kind === "WITHDRAWAL" || event.kind === "CHANNEL_PERFORMANCE"
          ? event.amountCents ?? 0
          : event.quantity ?? 0;
      }

      return {
        key,
        occurredOn: firstEvent.occurredOn,
        batchId: firstEvent.batch.id,
        sourceDate: firstEvent.batch.sourceDate,
        fingerprint: buildHistoryGroupFingerprint(groupedEvents),
        eventIds: groupedEvents.map((event) => event.id).sort((left, right) => left.localeCompare(right)),
        editable: groupedEvents.every((event) => event.derivedFromLedger !== true),
        metrics,
        batch: {
          id: firstEvent.batch.id,
          group: firstEvent.batch.group,
          channel: firstEvent.batch.channel,
        },
        enteredBy: firstEvent.enteredBy,
      };
    })
    .sort(compareHistoryGroups);
}

/**
 * The member workflow is phone-first. These three figures must therefore be
 * calculated from the current customer records, rather than the old one-time
 * event snapshots written at import time.
 */
export function synchronizeHistoryLeadCounts(groups: readonly HistoryGroup[], leads: readonly HistoryLeadCount[]): HistoryGroup[] {
  const counts = new Map<string, { total: number; invalid: number }>();
  for (const lead of leads) {
    const key = `${lead.ownerId}::${lead.batchId}`;
    const current = counts.get(key) ?? { total: 0, invalid: 0 };
    current.total += 1;
    if (lead.invalid) current.invalid += 1;
    counts.set(key, current);
  }
  return groups.map((group) => {
    const current = counts.get(`${group.enteredBy.id}::${group.batchId}`);
    if (!current) return group;
    return {
      ...group,
      metrics: {
        ...group.metrics,
        newFans: current.total,
        effectiveFans: current.total - current.invalid,
        noNumber: current.invalid,
        duplicateFans: 0,
      },
    };
  });
}
