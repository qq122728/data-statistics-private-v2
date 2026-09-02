import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { leadDateRangeForPreset, resolveDateRangeWithDefault, resolveLeadDateRange } from "../../src/lib/lead-date-range";

describe("lead date ranges", () => {
  const today = "2026-08-15";

  it("resolves all management presets with inclusive dates", () => {
    expect(leadDateRangeForPreset("all", today)).toMatchObject({ preset: "all", from: "", to: "" });
    expect(leadDateRangeForPreset("today", today)).toMatchObject({ from: today, to: today });
    expect(leadDateRangeForPreset("yesterday", today)).toMatchObject({ from: "2026-08-14", to: "2026-08-14" });
    expect(leadDateRangeForPreset("7d", today)).toMatchObject({ from: "2026-08-09", to: today });
    expect(leadDateRangeForPreset("week", today)).toMatchObject({ from: "2026-08-10", to: today });
    expect(leadDateRangeForPreset("30d", today)).toMatchObject({ from: "2026-07-17", to: today });
    expect(leadDateRangeForPreset("month", today)).toMatchObject({ from: "2026-08-01", to: today });
  });

  it("defaults to seven days and normalizes a reversed custom range", () => {
    expect(resolveLeadDateRange({}, today).preset).toBe("7d");
    expect(resolveLeadDateRange({ range: "custom", sourceDateFrom: "2026-08-12", sourceDateTo: "2026-08-03" }, today)).toMatchObject({ from: "2026-08-03", to: "2026-08-12" });
  });

  it("preserves an explicit all-customers selection", () => {
    expect(resolveLeadDateRange({ range: "all" }, today)).toMatchObject({ preset: "all", from: "", to: "" });
  });

  it("supports a whole month from the month dropdown", () => {
    expect(resolveLeadDateRange({ month: "2026-07" }, today)).toMatchObject({ preset: "custom", from: "2026-07-01", to: "2026-07-31" });
    expect(resolveLeadDateRange({ month: "2026-08" }, today)).toMatchObject({ preset: "custom", from: "2026-08-01", to: today });
  });

  it("supports one day from the month and day dropdowns", () => {
    expect(resolveLeadDateRange({ month: "2026-08", day: "10" }, today)).toMatchObject({ preset: "custom", from: "2026-08-10", to: "2026-08-10" });
  });

  it("lets analysis pages choose a consistent thirty-day default without overriding an explicit range", () => {
    expect(resolveDateRangeWithDefault({}, today)).toMatchObject({ preset: "30d", from: "2026-07-17", to: today });
    expect(resolveDateRangeWithDefault({ range: "today" }, today)).toMatchObject({ preset: "today", from: today, to: today });
    expect(resolveDateRangeWithDefault({ sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-03" }, today)).toMatchObject({ preset: "custom", from: "2026-08-01", to: "2026-08-03" });
  });

  it("supports the company workspace defaulting to the current month", () => {
    expect(resolveDateRangeWithDefault({}, today, "month")).toMatchObject({ preset: "month", from: "2026-08-01", to: today });
  });

  it("gives the group leader quick dates, the current range and a custom range", () => {
    const groupSource = readFileSync("apps/frontline/components/GroupChannelAnalysis.tsx", "utf8");
    const source = readFileSync("apps/frontline/components/SmartDateRangeToolbar.tsx", "utf8");
    expect(groupSource).toContain("SmartDateRangeToolbar");
    for (const label of ["今天", "昨天", "近7天", "本周", "本月", "上月", "自定义", "当前范围"]) {
      expect(source).toContain(label);
    }
    expect(source).toContain('type="date"');
    expect(groupSource).toContain("待资源部核对");
  });
});
