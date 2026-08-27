import { describe, expect, it, vi } from "vitest";
import { defaultRiskSettings, parseRiskSettings, toRiskSettingEntries } from "../../src/lib/risk-settings";

describe("risk settings parsing", () => {
  it("uses the documented defaults when risk settings have not been stored", () => {
    expect(parseRiskSettings([])).toEqual(defaultRiskSettings);
  });

  it("converts integer basis points from SystemSetting into efficiency thresholds", () => {
    expect(parseRiskSettings([
      { key: "risk.trainingDays", value: "10" },
      { key: "risk.coachingEfficiencyBps", value: "8250" },
      { key: "risk.priceComparisonMinOrders", value: "12" },
    ])).toMatchObject({
      trainingDays: 10,
      coachingEfficiency: 0.825,
      priceComparisonMinOrders: 12,
    });
  });

  it("serializes efficiency thresholds as integer basis points for SystemSetting", () => {
    expect(toRiskSettingEntries({ ...defaultRiskSettings, coachingEfficiency: 0.0003 })).toContainEqual({
      key: "risk.coachingEfficiencyBps",
      value: "3",
    });
  });

  it("refuses to silently round an efficiency below basis-point precision", () => {
    expect(() => toRiskSettingEntries({ ...defaultRiskSettings, coachingEfficiency: 0.12345 }))
      .toThrowError(new RangeError("效率阈值最多保留 4 位小数"));
  });

  it("falls back to defaults and logs an observable error for invalid stored values", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(parseRiskSettings([{ key: "risk.limitEfficiencyBps", value: "not-a-number" }])).toMatchObject({
      limitEfficiency: defaultRiskSettings.limitEfficiency,
    });
    expect(parseRiskSettings([{ key: "risk.eliminationDays", value: "" }])).toMatchObject({
      eliminationDays: defaultRiskSettings.eliminationDays,
    });
    expect(error).toHaveBeenCalled();

    error.mockRestore();
  });
});
