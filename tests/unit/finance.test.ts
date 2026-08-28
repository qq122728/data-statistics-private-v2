import { describe, expect, it } from "vitest";
import { validateFanBreakdown } from "../../src/lib/finance";

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
