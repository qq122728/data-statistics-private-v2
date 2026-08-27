import { describe, expect, it } from "vitest";
import {
  buildHistoryGroupFingerprint,
  groupHistoryEvents,
  historyMetricFields,
  synchronizeHistoryLeadCounts,
  type HistoryGroup,
  type HistoryGroupEvent,
} from "../../src/lib/history-groups";
import { compareHistoryGroups } from "../../src/lib/history-group-order";

const batch = {
  id: "batch-a",
  sourceDate: "2026-08-10",
  group: { id: "group-a", name: "第一组", active: true },
  channel: { id: "channel-a", name: "抖音", active: true },
};

const memberA = { id: "member-a", name: "小王", active: true };

function event(overrides: Partial<HistoryGroupEvent>): HistoryGroupEvent {
  return {
    id: "event-a",
    occurredOn: "2026-08-12",
    kind: "REPLIES",
    quantity: 2,
    amountCents: null,
    batch,
    enteredBy: memberA,
    ...overrides,
  };
}

describe("groupHistoryEvents", () => {
  it("exposes and aggregates every fan-quality and financial history field", () => {
    const groups = groupHistoryEvents([
      event({ id: "new", kind: "NEW_FANS", quantity: 100 }),
      event({ id: "effective", kind: "EFFECTIVE_FANS", quantity: 80 }),
      event({ id: "no-number", kind: "NO_NUMBER", quantity: 10 }),
      event({ id: "duplicate", kind: "DUPLICATE_FANS", quantity: 5 }),
      event({ id: "withdrawal", kind: "WITHDRAWAL", quantity: null, amountCents: 1200 }),
      event({ id: "performance", kind: "CHANNEL_PERFORMANCE", quantity: null, amountCents: 3400 }),
    ]);

    expect(historyMetricFields).toEqual([
      "newFans", "effectiveFans", "noNumber", "duplicateFans",
      "replies", "groupJoin", "groupLeave", "expertIntro",
      "registration", "order", "rechargeCents",
      "withdrawalCents", "channelPerformanceCents",
    ]);
    expect(groups[0].metrics).toEqual({
      newFans: 100,
      effectiveFans: 80,
      noNumber: 10,
      duplicateFans: 5,
      replies: 0,
      groupJoin: 0,
      groupLeave: 0,
      expertIntro: 0,
      registration: 0,
      order: 0,
      rechargeCents: 0,
      withdrawalCents: 1200,
      channelPerformanceCents: 3400,
    });
  });

  it("groups each actor's same-batch daily metrics and sums their values", () => {
    const groups = groupHistoryEvents([
      event({ id: "event-a", quantity: 2 }),
      event({ id: "event-b", quantity: 3 }),
      event({ id: "event-c", kind: "GROUP_JOIN", quantity: 4 }),
      event({ id: "event-d", kind: "RECHARGE", quantity: null, amountCents: 1250 }),
      event({ id: "event-e", kind: "RECHARGE", quantity: null, amountCents: 750 }),
      event({ id: "event-f", occurredOn: "2026-08-11", quantity: 1 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].metrics).toMatchObject({ replies: 5, groupJoin: 4, rechargeCents: 2000 });
    expect(groups[0].eventIds).toEqual(["event-a", "event-b", "event-c", "event-d", "event-e"]);
    expect(groups[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(groups[0].key).toBe("member-a::2026-08-12::batch-a");
    expect(groups[1].metrics.rechargeCents).toBe(0);
    expect(groups[1].metrics.replies).toBe(1);
  });

  it("places newer occurrence dates before older ones", () => {
    const groups = groupHistoryEvents([
      event({ id: "older", occurredOn: "2026-08-11" }),
      event({ id: "newer", occurredOn: "2026-08-12" }),
    ]);

    expect(groups.map((group) => group.occurredOn)).toEqual(["2026-08-12", "2026-08-11"]);
  });

  it("exposes the same stable ordering for client-side replacement", () => {
    const groups = groupHistoryEvents([
      event({ id: "older", occurredOn: "2026-08-11" }),
      event({ id: "newer", occurredOn: "2026-08-12" }),
    ]);
    const replacement = { ...groups[1], occurredOn: "2026-08-13", key: "member-a::2026-08-13::batch-a" } satisfies HistoryGroup;

    expect([groups[0], replacement].sort(compareHistoryGroups).map((group) => group.occurredOn)).toEqual([
      "2026-08-13",
      "2026-08-12",
    ]);
  });

  it("does not merge metrics entered by different actors", () => {
    const groups = groupHistoryEvents([
      event({ id: "member-a-event", quantity: 2 }),
      event({ id: "member-b-event", quantity: 3, enteredBy: { id: "member-b", name: "小李", active: true } }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.enteredBy.id)).toEqual(["member-a", "member-b"]);
    expect(groups.map((group) => group.metrics.replies)).toEqual([2, 3]);
  });

  it("uses the current phone records for fan, invalid, and effective counts", () => {
    const [group] = groupHistoryEvents([
      event({ id: "new", kind: "NEW_FANS", quantity: 20 }),
      event({ id: "effective", kind: "EFFECTIVE_FANS", quantity: 20 }),
    ]);
    const [synced] = synchronizeHistoryLeadCounts([group], [
      { ownerId: "member-a", batchId: "batch-a", invalid: false },
      { ownerId: "member-a", batchId: "batch-a", invalid: false },
      { ownerId: "member-a", batchId: "batch-a", invalid: true },
      { ownerId: "member-b", batchId: "batch-a", invalid: false },
    ]);

    expect(synced.metrics).toMatchObject({ newFans: 3, effectiveFans: 2, noNumber: 1, duplicateFans: 0 });
  });

  it("marks phone-ledger compatibility groups as read-only", () => {
    const [group] = groupHistoryEvents([
      event({ id: "derived", kind: "NEW_FANS", quantity: 1, derivedFromLedger: true }),
    ]);

    expect(group.editable).toBe(false);
  });

  it("makes a group's fingerprint independent of event input order", () => {
    const events = [
      event({ id: "event-a", quantity: 2 }),
      event({ id: "event-b", kind: "GROUP_JOIN", quantity: 4 }),
      event({ id: "event-c", quantity: 0 }),
    ];

    expect(groupHistoryEvents(events)[0].fingerprint).toBe(
      groupHistoryEvents([events[2], events[0], events[1]])[0].fingerprint,
    );
  });

  it("changes a group's fingerprint when an existing event value changes to zero", () => {
    const nonzeroEvent = event({ id: "event-a", quantity: 2 });
    const zeroValueEvent = event({ id: "event-a", quantity: 0 });

    expect(buildHistoryGroupFingerprint([nonzeroEvent])).not.toBe(
      buildHistoryGroupFingerprint([zeroValueEvent]),
    );
  });

  it("includes a distinct zero-valued event in the fingerprint", () => {
    const nonzeroEvent = event({ id: "event-a", quantity: 2 });
    const zeroValueEvent = event({ id: "event-z", quantity: 0 });

    expect(buildHistoryGroupFingerprint([nonzeroEvent])).not.toBe(
      buildHistoryGroupFingerprint([nonzeroEvent, zeroValueEvent]),
    );
  });
});
