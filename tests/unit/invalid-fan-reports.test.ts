import { describe, expect, it } from "vitest";
import { finalizeInvalidFanReport, validateInvalidFanCounts } from "../../src/lib/invalid-fan-reports";

describe("invalid fan reports", () => {
  it("rejects negative or non-integer manual counts", () => {
    expect(validateInvalidFanCounts({ noWsCount: 2, lowAmountCount: 3, collisionCount: 1 })).toEqual({ ok: true });
    expect(validateInvalidFanCounts({ noWsCount: -1, lowAmountCount: 0, collisionCount: 0 })).toMatchObject({ ok: false });
    expect(validateInvalidFanCounts({ noWsCount: 1.5, lowAmountCount: 0, collisionCount: 0 })).toMatchObject({ ok: false });
  });

  it("keeps a pending report out of official totals until a leader approves it", () => {
    const pending = finalizeInvalidFanReport({
      status: "PENDING",
      noWsCount: 2,
      lowAmountCount: 3,
      collisionCount: 1,
      approvedNoWsCount: null,
      approvedLowAmountCount: null,
      approvedCollisionCount: null,
    });
    expect(pending).toEqual({ noWsCount: 0, lowAmountCount: 0, collisionCount: 0, total: 0 });

    const approved = finalizeInvalidFanReport({
      status: "APPROVED",
      noWsCount: 2,
      lowAmountCount: 3,
      collisionCount: 1,
      approvedNoWsCount: 2,
      approvedLowAmountCount: 4,
      approvedCollisionCount: 1,
    });
    expect(approved).toEqual({ noWsCount: 2, lowAmountCount: 4, collisionCount: 1, total: 7 });
  });
});
