import { describe, expect, it } from "vitest";
import { resolveMemberPeriods } from "../../src/lib/analytics/member-periods";

describe("member overview mature source periods", () => {
  it("defaults to the latest 30 D7-mature source dates with an equal previous period", () => {
    expect(resolveMemberPeriods({}, "2026-08-14")).toEqual({
      period: "mature30",
      current: { sourceDateFrom: "2026-07-09", sourceDateTo: "2026-08-07", sourceDayCount: 30 },
      previous: { sourceDateFrom: "2026-06-09", sourceDateTo: "2026-07-08", sourceDayCount: 30 },
      warning: null,
    });
  });

  it("resolves the seven-day mature shortcut relative to the same D7 cutoff", () => {
    expect(resolveMemberPeriods({ period: "mature7" }, "2026-08-14")).toEqual({
      period: "mature7",
      current: { sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-07", sourceDayCount: 7 },
      previous: { sourceDateFrom: "2026-07-25", sourceDateTo: "2026-07-31", sourceDayCount: 7 },
      warning: null,
    });
  });

  it("keeps a custom source range and derives the immediately previous equal-length range", () => {
    expect(resolveMemberPeriods({
      period: "custom",
      sourceDateFrom: "2026-08-01",
      sourceDateTo: "2026-08-03",
    }, "2026-08-14")).toEqual({
      period: "custom",
      current: { sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-03", sourceDayCount: 3 },
      previous: { sourceDateFrom: "2026-07-29", sourceDateTo: "2026-07-31", sourceDayCount: 3 },
      warning: null,
    });
  });

  it("falls back to mature30 with a warning for invalid URL values or custom ranges", () => {
    for (const input of [
      { period: "unknown" },
      { period: "custom" },
      { period: "custom", sourceDateFrom: "2026-08-08", sourceDateTo: "2026-08-01" },
      { period: "custom", sourceDateFrom: "2026-02-30", sourceDateTo: "2026-08-01" },
      { period: "custom", sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-15" },
    ]) {
      expect(resolveMemberPeriods(input, "2026-08-14")).toMatchObject({
        period: "mature30",
        current: { sourceDateFrom: "2026-07-09", sourceDateTo: "2026-08-07", sourceDayCount: 30 },
        warning: "组员统计周期无效，已恢复最近 30 个成熟来源日。",
      });
    }
  });
});
