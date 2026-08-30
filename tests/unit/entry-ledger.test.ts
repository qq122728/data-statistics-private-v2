import { describe, expect, it } from "vitest";
import {
  calculateDailyFinancialSummary,
  calculateEffectiveFans,
  getNextContinuationNumber,
  normalizeCustomerPhone,
} from "../../src/lib/entry-ledger";

describe("member entry ledger rules", () => {
  it("calculates effective fans from received and invalid counts", () => {
    expect(calculateEffectiveFans(10, 3)).toBe(7);
    expect(calculateEffectiveFans(0, 0)).toBe(0);
    expect(() => calculateEffectiveFans(3, 4)).toThrow("无效粉数量不能大于当日接粉数量");
  });

  it("normalizes a phone before enforcing one opening per number", () => {
    expect(normalizeCustomerPhone("138 0013-8000")).toBe("138000");
    expect(normalizeCustomerPhone("+86 138 0013 8000")).toBe("138000");
    expect(normalizeCustomerPhone("381002")).toBe("381002");
    expect(() => normalizeCustomerPhone("123")).toThrow("客户号码至少需要 6 位数字");
  });

  it("chooses the first unused continuation number", () => {
    expect(getNextContinuationNumber([])).toBe(1);
    expect(getNextContinuationNumber([1, 2, 4])).toBe(3);
    expect(getNextContinuationNumber([3, 1, 2])).toBe(4);
  });

  it("includes initial deposits in the daily net performance", () => {
    expect(calculateDailyFinancialSummary({
      initialDepositCents: 150_000,
      continuationDepositCents: 80_000,
      withdrawalCents: 20_000,
    })).toEqual({
      initialDepositCents: 150_000,
      continuationDepositCents: 80_000,
      totalDepositCents: 230_000,
      withdrawalCents: 20_000,
      netPerformanceCents: 210_000,
    });
  });
});
