import { describe, expect, it } from "vitest";
import {
  aggregateEventsByOwner,
  getBatchStatus,
  getDeepestStage,
  getLargestDrop,
  getMaturity,
  getSampleState,
} from "../../src/lib/analytics/metrics";
import { emptyBatchTotals, type BatchTotals } from "../../src/lib/metrics";

const totals = (overrides: Partial<BatchTotals> = {}): BatchTotals => ({ ...emptyBatchTotals(), ...overrides });

describe("management analysis metric rules", () => {
  it("makes cohorts rankable only after twenty new fans and reports calendar maturity", () => {
    expect(getSampleState(19)).toBe("INSUFFICIENT");
    expect(getSampleState(20)).toBe("RANKABLE");
    expect(getMaturity("2026-08-01", "2026-08-08")).toEqual({ d7: true, d14: false, ageDays: 7 });
  });

  it("finds the largest adjacent funnel loss without treating recharge as a person stage", () => {
    expect(getLargestDrop(totals({
      newFans: 100, replies: 60, groupJoin: 40, groupLeave: 5,
      expertIntro: 10, registration: 8, orders: 2, rechargeCents: 50000,
    }))).toMatchObject({ from: "NEW_FANS", to: "REPLIES", lost: 40 });
    expect(getDeepestStage(totals({ newFans: 20, replies: 5, groupJoin: 2 }))).toBe("GROUP_JOIN");
  });

  it("applies batch status priority and only calls old, large zero-order cohorts stalled", () => {
    expect(getBatchStatus({
      totals: totals({ newFans: 20, groupJoin: 8 }), sourceDate: "2026-08-01", today: "2026-08-08", lastProgressedOn: "2026-08-04",
    })).toBe("STALLED");
    expect(getBatchStatus({
      totals: totals({ newFans: 20, groupJoin: 25, orders: 1 }), sourceDate: "2026-08-01", today: "2026-08-08", lastProgressedOn: "2026-08-01",
    })).toBe("DATA_ANOMALY");
    expect(getBatchStatus({
      totals: totals({ newFans: 4, orders: 1 }), sourceDate: "2026-08-01", today: "2026-08-08", lastProgressedOn: "2026-08-01",
    })).toBe("ORDERED");
  });

  it("aggregates raw events by their owner before funnel calculations", () => {
    const byOwner = aggregateEventsByOwner([
      { enteredById: "a", kind: "NEW_FANS" as const, quantity: 10 },
      { enteredById: "a", kind: "GROUP_JOIN" as const, quantity: 4 },
      { enteredById: "b", kind: "RECHARGE" as const, amountCents: 900 },
    ]);

    expect(byOwner).toEqual({
      a: expect.objectContaining({ newFans: 10, groupJoin: 4 }),
      b: expect.objectContaining({ rechargeCents: 900 }),
    });
  });
});
