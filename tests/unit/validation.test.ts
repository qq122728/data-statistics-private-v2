import { describe, expect, it } from "vitest";
import { parseHistoryGroupUpdate, parseMetricInput, parseNewFansInput, validateFanBreakdown } from "../../src/lib/validation";

const completeHistoryGroupUpdate = {
  eventIds: ["event-a", "event-b"],
  fingerprint: "a".repeat(64),
  occurredOn: "2026-08-12",
  batchId: "batch-a",
  metrics: {
    newFans: 1,
    effectiveFans: 1,
    noNumber: 0,
    duplicateFans: 0,
    replies: 2,
    groupJoin: 3,
    groupLeave: 4,
    expertIntro: 5,
    registration: 6,
    order: 7,
    rechargeCents: 800,
    withdrawalCents: 0,
    channelPerformanceCents: 0,
  },
};

describe("metric input validation", () => {
  it("rejects a negative new-fans quantity", () => {
    expect(() => parseNewFansInput({ quantity: -1 })).toThrow();
  });

  it("accepts a new channel name for a new-fans row", () => {
    expect(parseNewFansInput({
      channelName: "抖音直播",
      sourceDate: "2026-08-11",
      quantity: 4,
      effectiveFans: 4,
      noNumber: 0,
      duplicateFans: 0,
    })).toMatchObject({ channelName: "抖音直播" });
  });

  it("rejects a new-fans row whose status breakdown exceeds acquired fans", () => {
    expect(() => parseNewFansInput({
      channelId: "channel-1",
      sourceDate: "2026-08-11",
      quantity: 4,
      effectiveFans: 3,
      noNumber: 1,
      duplicateFans: 1,
    })).toThrow("有效粉、无 WS 号码和撞粉合计不能大于提交号码");
  });

  it.each(["WITHDRAWAL", "CHANNEL_PERFORMANCE"] as const)("accepts %s as an amount event", (kind) => {
    expect(parseMetricInput({
      batchId: "batch-1",
      occurredOn: "2026-08-10",
      kind,
      amountCents: 100,
    })).toMatchObject({ kind, amountCents: 100 });
  });

  it.each(["WITHDRAWAL", "CHANNEL_PERFORMANCE"] as const)("rejects a quantity attached to %s", (kind) => {
    expect(() => parseMetricInput({
      batchId: "batch-1",
      occurredOn: "2026-08-10",
      kind,
      amountCents: 100,
      quantity: 1,
    })).toThrow();
  });

  it("rejects a follow-up event without a batch", () => {
    expect(() =>
      parseMetricInput({
        occurredOn: "2026-08-10",
        kind: "GROUP_JOIN",
        quantity: 1,
      }),
    ).toThrow();
  });

  it("rejects a negative recharge amount", () => {
    expect(() =>
      parseMetricInput({
        batchId: "batch-1",
        occurredOn: "2026-08-10",
        kind: "RECHARGE",
        amountCents: -1,
      }),
    ).toThrow();
  });

  it("rejects a quantity event that also sends an amount", () => {
    expect(() =>
      parseMetricInput({
        batchId: "batch-1",
        occurredOn: "2026-08-10",
        kind: "ORDER",
        quantity: 1,
        amountCents: 100,
      }),
    ).toThrow();
  });

  it("rejects a calendar date that does not exist", () => {
    expect(() =>
      parseNewFansInput({
        channelId: "channel-1",
        sourceDate: "2026-02-30",
        quantity: 1,
        effectiveFans: 0,
        noNumber: 0,
        duplicateFans: 0,
      }),
    ).toThrow();

    expect(() =>
      parseMetricInput({
        batchId: "batch-1",
        occurredOn: "2026-13-01",
        kind: "GROUP_JOIN",
        quantity: 1,
      }),
    ).toThrow();
  });

  it("rejects a quantity beyond the signed Prisma Int range", () => {
    expect(() =>
      parseMetricInput({
        batchId: "batch-1",
        occurredOn: "2026-08-10",
        kind: "ORDER",
        quantity: 2_147_483_648,
      }),
    ).toThrow();
  });

  it("rejects a recharge amount beyond the signed Prisma Int range", () => {
    expect(() =>
      parseMetricInput({
        batchId: "batch-1",
        occurredOn: "2026-08-10",
        kind: "RECHARGE",
        amountCents: 2_147_483_648,
      }),
    ).toThrow();
  });
});

describe("history group update validation", () => {
  it("accepts a complete editable history-group payload", () => {
    expect(parseHistoryGroupUpdate(completeHistoryGroupUpdate)).toEqual(completeHistoryGroupUpdate);
  });

  it("rejects an invalid history-group occurrence date", () => {
    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, occurredOn: "2026-02-30" })).toThrow();
  });

  it("rejects negative, fractional, and overflowing metric values", () => {
    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, metrics: { ...completeHistoryGroupUpdate.metrics, replies: -1 } })).toThrow();
    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, metrics: { ...completeHistoryGroupUpdate.metrics, replies: 1.5 } })).toThrow();
    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, metrics: { ...completeHistoryGroupUpdate.metrics, replies: 2_147_483_648 } })).toThrow();
  });

  it("rejects duplicate event IDs", () => {
    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, eventIds: ["event-a", "event-a"] })).toThrow();
  });

  it("rejects missing metric fields", () => {
    const { order: _order, ...incompleteMetrics } = completeHistoryGroupUpdate.metrics;

    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, metrics: incompleteMetrics })).toThrow();
  });

  it("rejects unknown payload properties and malformed fingerprints", () => {
    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, unexpected: true })).toThrow();
    expect(() => parseHistoryGroupUpdate({ ...completeHistoryGroupUpdate, fingerprint: "A".repeat(64) })).toThrow();
  });
});

describe("fan breakdown validation", () => {
  it("rejects fan statuses that exceed the acquired-fan total", () => {
    expect(validateFanBreakdown({
      newFans: 100,
      effectiveFans: 60,
      noNumber: 30,
      duplicateFans: 20,
    })).toEqual({ valid: false, message: "有效粉、无 WS 号码和撞粉合计不能大于提交号码" });
  });

  it("accepts fan statuses that exactly account for acquired fans", () => {
    expect(validateFanBreakdown({
      newFans: 100,
      effectiveFans: 60,
      noNumber: 30,
      duplicateFans: 10,
    })).toEqual({ valid: true });
  });
});
