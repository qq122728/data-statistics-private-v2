import { describe, expect, it } from "vitest";
import { conversionRatePercent, gradeConversion, hasReachedBusinessDay, validateConversionStandards } from "../../src/lib/conversion-standards";

const standards = {
  receptionJoin: { pass: 10, good: 15, excellent: 20 },
  operatorExpert: { pass: 60, good: 70, excellent: 80 },
  expertOrder: { pass: 10, good: 15, excellent: 20 },
};

describe("group conversion grading", () => {
  it("grades the operator from the agreed 60/70/80 thresholds", () => {
    expect(gradeConversion(0, 0, standards.operatorExpert)).toBe("NO_SAMPLE");
    expect(gradeConversion(5, 10, standards.operatorExpert)).toBe("BELOW_PASS");
    expect(gradeConversion(6, 10, standards.operatorExpert)).toBe("PASS");
    expect(gradeConversion(7, 10, standards.operatorExpert)).toBe("GOOD");
    expect(gradeConversion(8, 10, standards.operatorExpert)).toBe("EXCELLENT");
  });

  it("caps display rate and never rates an empty denominator", () => {
    expect(conversionRatePercent(3, 2)).toBe(100);
    expect(conversionRatePercent(0, 0)).toBeNull();
  });

  it("uses business days for operator day 3 and expert day 2 eligibility", () => {
    expect(hasReachedBusinessDay("2026-08-14", "2026-08-16", 2)).toBe(true);
    expect(hasReachedBusinessDay("2026-08-15", "2026-08-16", 2)).toBe(false);
    expect(hasReachedBusinessDay("2026-08-15", "2026-08-16", 1)).toBe(true);
    expect(hasReachedBusinessDay(null, "2026-08-16", 1)).toBe(false);
  });

  it("accepts complete increasing standards", () => {
    expect(validateConversionStandards(standards)).toEqual({ valid: true, standards });
  });

  it("rejects missing, out-of-range and reversed standards", () => {
    expect(validateConversionStandards(null).valid).toBe(false);
    expect(validateConversionStandards({ ...standards, operatorExpert: { pass: 60, good: 60, excellent: 80 } }).valid).toBe(false);
    expect(validateConversionStandards({ ...standards, expertOrder: { pass: -1, good: 15, excellent: 20 } }).valid).toBe(false);
  });
});
