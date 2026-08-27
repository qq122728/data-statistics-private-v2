import { describe, expect, it } from "vitest";
import { calculateFinancials, validateFanBreakdown } from "../../src/lib/finance";

describe("financial calculations", () => {
  it("calculates cost, net performance, and profit from priced channel results", () => {
    expect(calculateFinancials({
      effectiveFans: 100,
      effectiveFanPriceCents: 5_000,
      rechargeCents: 800_000,
      channelPerformanceCents: 100_000,
      withdrawalCents: 200_000,
    })).toEqual({
      costCents: 500_000,
      netPerformanceCents: 600_000,
      profitCents: 100_000,
      priceState: "PRICED",
    });
  });

  it("keeps net performance while price is pending", () => {
    expect(calculateFinancials({
      effectiveFans: 100,
      effectiveFanPriceCents: null,
      rechargeCents: 800_000,
      channelPerformanceCents: 100_000,
      withdrawalCents: 200_000,
    })).toEqual({
      costCents: null,
      netPerformanceCents: 600_000,
      profitCents: null,
      priceState: "PENDING_PRICE",
    });
  });

  it("credits rebate-material performance after the monthly 30% rebate, without charging fan cost", () => {
    expect(calculateFinancials({
      effectiveFans: 10,
      effectiveFanPriceCents: 0,
      rechargeCents: 1_000_000,
      channelPerformanceCents: 0,
      withdrawalCents: 200_000,
      channelType: "REBATE",
      rebateRateBps: 3_000,
    })).toEqual({
      costCents: 0,
      netPerformanceCents: 800_000,
      profitCents: 560_000,
      priceState: "PRICED",
      rebateCents: 240_000,
      creditedPerformanceCents: 560_000,
    });
  });

  it("returns the exact largest priced result that remains safely representable", () => {
    expect(calculateFinancials({
      effectiveFans: 4_194_304,
      effectiveFanPriceCents: 2_147_483_647,
      rechargeCents: 0,
      channelPerformanceCents: 0,
      withdrawalCents: 0,
    })).toEqual({
      costCents: 9_007_199_250_546_688,
      netPerformanceCents: 0,
      profitCents: -9_007_199_250_546_688,
      priceState: "PRICED",
    });
  });

  it("rejects a cost from legal database extrema instead of returning a rounded number", () => {
    expect(() => calculateFinancials({
      effectiveFans: 2_147_483_647,
      effectiveFanPriceCents: 2_147_483_647,
      rechargeCents: 0,
      channelPerformanceCents: 0,
      withdrawalCents: 0,
    })).toThrowError(new RangeError("财务计算结果 costCents 超出安全整数范围"));
  });

  it("rejects an unsafe profit even when the cost itself is still safe", () => {
    expect(() => calculateFinancials({
      effectiveFans: 4_194_304,
      effectiveFanPriceCents: 2_147_483_647,
      rechargeCents: 0,
      channelPerformanceCents: 0,
      withdrawalCents: 2_147_483_647,
    })).toThrowError(new RangeError("财务计算结果 profitCents 超出安全整数范围"));
  });

  it("rejects unsafe integer inputs before converting them to BigInt", () => {
    expect(() => calculateFinancials({
      effectiveFans: Number.MAX_SAFE_INTEGER + 1,
      effectiveFanPriceCents: 1,
      rechargeCents: 0,
      channelPerformanceCents: 0,
      withdrawalCents: 0,
    })).toThrowError(new RangeError("财务计算输入 effectiveFans 必须是安全整数"));
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
