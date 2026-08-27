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
      pendingPriceChannels: [{ id: "pending", groupId: "group-a", name: "待定价渠道" }],
    });

    expect(new Set(risks.map((risk) => risk.code))).toEqual(new Set([
      "UNCONFIRMED",
      "LONG_NO_RECORD",
      "DOWNSTREAM_EXCEEDS_UPSTREAM",
      "LEAVE_EXCEEDS_JOIN",
      "FREQUENT_HISTORY_EDITS",
      "PENDING_PRICE",
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
      pendingPriceChannels: [],
    });

    expect(risks).toEqual([
      expect.objectContaining({ category: "DATA", code: "DOWNSTREAM_EXCEEDS_UPSTREAM" }),
    ]);
  });

  it("emits financial warnings only from priced, valid period results", () => {
    const risks = evaluateFinancialRisks({
      current: {
        dataValid: true,
        financials: { costCents: 30_000, netPerformanceCents: 10_000, profitCents: -20_000, priceState: "PRICED" },
        rechargeCents: 20_000,
        channelPerformanceCents: 0,
        withdrawalCents: 25_000,
      },
      previous: {
        dataValid: true,
        financials: { costCents: 15_000, netPerformanceCents: 10_000, profitCents: -5_000, priceState: "PRICED" },
        rechargeCents: 20_000,
        channelPerformanceCents: 0,
        withdrawalCents: 10_000,
      },
      significantProfitDropRatio: 0.5,
    });

    expect(new Set(risks.map((risk) => risk.code))).toEqual(new Set([
      "SUSTAINED_LOSS",
      "SIGNIFICANT_PROFIT_DROP",
      "WITHDRAWAL_ANOMALY",
    ]));
    expect(risks.every((risk) => risk.category === "FINANCIAL")).toBe(true);
  });

  it("turns an unpriced channel into DATA evidence and never fabricates a loss warning", () => {
    const dataRisks = evaluateDataRisks({
      evaluationDate: "2026-08-14",
      confirmed: true,
      daysSinceLastRecord: 0,
      longNoRecordDays: 7,
      totals: emptyBatchTotals(),
      historyModificationCount: 0,
      frequentModificationCount: 3,
      pendingPriceChannels: [{ id: "pending", groupId: "group-a", name: "待定价渠道" }],
    });
    const financialRisks = evaluateFinancialRisks({
      current: {
        dataValid: true,
        financials: { costCents: null, netPerformanceCents: -100_000, profitCents: null, priceState: "PENDING_PRICE" },
        rechargeCents: 10_000,
        channelPerformanceCents: 0,
        withdrawalCents: 110_000,
      },
      previous: null,
    });

    expect(dataRisks).toEqual([
      expect.objectContaining({ category: "DATA", code: "PENDING_PRICE" }),
    ]);
    expect(financialRisks).toEqual([]);
  });

  it("suppresses all financial conclusions when the business funnel is invalid", () => {
    expect(evaluateFinancialRisks({
      current: {
        dataValid: false,
        financials: { costCents: 20_000, netPerformanceCents: -10_000, profitCents: -30_000, priceState: "PRICED" },
        rechargeCents: 10_000,
        channelPerformanceCents: 0,
        withdrawalCents: 20_000,
      },
      previous: {
        dataValid: true,
        financials: { costCents: 10_000, netPerformanceCents: 0, profitCents: -10_000, priceState: "PRICED" },
        rechargeCents: 10_000,
        channelPerformanceCents: 0,
        withdrawalCents: 10_000,
      },
    })).toEqual([]);
  });
});
