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
    expect(normalizeCustomerPhone("138 0013-8000")).toBe("13800138000");
    expect(normalizeCustomerPhone("+86 138 0013 8000")).toBe("+8613800138000");
    expect(() => normalizeCustomerPhone("123")).toThrow("请输入有效的手机号码");
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
