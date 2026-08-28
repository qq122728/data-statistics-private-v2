import { describe, expect, it } from "vitest";
import { emptyBatchTotals } from "../../src/lib/metrics";
import {
  evaluateDataRisks,
  evaluateFinancialRisks,
} from "../../src/lib/analytics/data-risk";

describe("member data and financial risk separation", () => {
  it("reports every supported data-quality issue only as DATA evidence", () => {
    const risks = evaluateDataRisks({
      evaluationDate: "2026-08-14",
      confirmed: false,
      daysSinceLastRecord: 8,
      longNoRecordDays: 7,
      totals: {
        ...emptyBatchTotals(),
        newFans: 10,
        replies: 11,
        groupJoin: 12,
        groupLeave: 13,
      },
      historyModificationCount: 3,
      frequentModificationCount: 3,
    });

    expect(new Set(risks.map((risk) => risk.code))).toEqual(new Set([
      "UNCONFIRMED",
      "LONG_NO_RECORD",
      "DOWNSTREAM_EXCEEDS_UPSTREAM",
      "LEAVE_EXCEEDS_JOIN",
      "FREQUENT_HISTORY_EDITS",
    ]));
    expect(risks.every((risk) => risk.category === "DATA")).toBe(true);
  });

  it("classifies an impossible effective-fan breakdown as DATA rather than performance", () => {
    const risks = evaluateDataRisks({
      evaluationDate: "2026-08-14",
      confirmed: true,
      daysSinceLastRecord: 0,
      longNoRecordDays: 7,
      totals: { ...emptyBatchTotals(), newFans: 10, effectiveFans: 8, noNumber: 2, duplicateFans: 1 },
      historyModificationCount: 0,
      frequentModificationCount: 3,
    });

    expect(risks).toEqual([
      expect.objectContaining({ category: "DATA", code: "DOWNSTREAM_EXCEEDS_UPSTREAM" }),
    ]);
  });

  it("flags a withdrawal anomaly only from a valid period", () => {
    const risks = evaluateFinancialRisks({
      current: {
        dataValid: true,
        rechargeCents: 20_000,
        channelPerformanceCents: 0,
        withdrawalCents: 25_000,
      },
      previous: null,
    });

    expect(risks).toEqual([
      expect.objectContaining({ category: "FINANCIAL", code: "WITHDRAWAL_ANOMALY" }),
    ]);
  });

  it("does not flag a withdrawal anomaly when withdrawals stay within recharges", () => {
    const risks = evaluateFinancialRisks({
      current: {
        dataValid: true,
        rechargeCents: 20_000,
        channelPerformanceCents: 0,
        withdrawalCents: 10_000,
      },
      previous: null,
    });

    expect(risks).toEqual([]);
  });

  it("suppresses all financial conclusions when the business funnel is invalid", () => {
    expect(evaluateFinancialRisks({
      current: {
        dataValid: false,
        rechargeCents: 10_000,
        channelPerformanceCents: 0,
        withdrawalCents: 20_000,
      },
      previous: {
        dataValid: true,
        rechargeCents: 10_000,
        channelPerformanceCents: 0,
        withdrawalCents: 10_000,
      },
    })).toEqual([]);
  });
});
