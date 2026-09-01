import { describe, expect, it } from "vitest";

import { buildGroupBusinessPeriods } from "../../src/lib/analytics/group-business-periods";
import { leadDateRangeForPreset } from "../../src/lib/lead-date-range";

describe("group business periods", () => {
  const department = { countryCode: "DE", timezone: "Europe/Berlin", workStartMinutes: 600, workEndMinutes: 1320 };
  const groups = [
    { id: "de", countryCode: null, timezone: null, workStartMinutes: null, workEndMinutes: null, department },
    { id: "sg", countryCode: "SG", timezone: "Asia/Singapore", workStartMinutes: null, workEndMinutes: null, department },
    { id: "us", countryCode: "US", timezone: "America/New_York", workStartMinutes: null, workEndMinutes: null, department },
  ];
  const now = new Date("2026-09-01T03:30:00Z");

  it("gives every group the same China-time statistical day", () => {
    const periods = buildGroupBusinessPeriods(groups, now, leadDateRangeForPreset("today", "2026-09-01"));

    expect(periods.de).toEqual({ today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" });
    expect(periods.sg).toEqual({ today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" });
    expect(periods.us).toEqual({ today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" });
  });

  it("gives every group the same statistical month", () => {
    const periods = buildGroupBusinessPeriods(groups, now, leadDateRangeForPreset("month", "2026-09-01"));

    expect(periods.de).toEqual({ today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" });
    expect(periods.sg).toEqual({ today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" });
    expect(periods.us).toEqual({ today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" });
  });

  it("gives every group the same rolling seven-day boundary", () => {
    const periods = buildGroupBusinessPeriods(groups, now, leadDateRangeForPreset("7d", "2026-09-01"));

    expect(periods.de).toEqual({ today: "2026-09-01", from: "2026-08-26", to: "2026-09-01" });
    expect(periods.sg).toEqual({ today: "2026-09-01", from: "2026-08-26", to: "2026-09-01" });
    expect(periods.us).toEqual({ today: "2026-09-01", from: "2026-08-26", to: "2026-09-01" });
  });
});
