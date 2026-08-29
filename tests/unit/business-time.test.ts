import { describe, expect, it } from "vitest";
import {
  BUSINESS_TIMEZONE_OPTIONS,
  businessTimezoneOption,
  businessWorkStatus,
  isSupportedBusinessTimezone,
  localClockMinutes,
  resolveGroupBusinessTime,
  resolveGroupBusinessDate,
} from "../../src/lib/business-time";

describe("group business time", () => {
  const department = {
    countryCode: "DE",
    timezone: "Europe/Berlin",
    workStartMinutes: 600,
    workEndMinutes: 1320,
  };

  it("inherits the company timezone when the group has no override", () => {
    expect(resolveGroupBusinessTime({
      countryCode: null,
      timezone: null,
      workStartMinutes: null,
      workEndMinutes: null,
      department,
    })).toEqual(department);
  });

  it("lets a US group override a German company's timezone", () => {
    expect(resolveGroupBusinessTime({
      countryCode: "US",
      timezone: "America/New_York",
      workStartMinutes: null,
      workEndMinutes: null,
      department,
    })).toMatchObject({ countryCode: "US", timezone: "America/New_York", workStartMinutes: 600, workEndMinutes: 1320 });
  });

  it("calculates work status in local time and handles daylight saving through IANA timezones", () => {
    const config = { countryCode: "DE", timezone: "Europe/Berlin", workStartMinutes: 600, workEndMinutes: 1320 };
    expect(businessWorkStatus(config, new Date("2026-08-16T07:59:00Z")).status).toBe("BEFORE_WORK");
    expect(businessWorkStatus(config, new Date("2026-08-16T08:00:00Z")).status).toBe("WORKING");
    expect(businessWorkStatus(config, new Date("2026-08-16T20:00:00Z")).status).toBe("AFTER_WORK");
  });

  it("supports Singapore and the expanded business-region timezone list", () => {
    expect(businessTimezoneOption("Asia/Singapore")).toMatchObject({
      countryCode: "SG",
      label: "新加坡时间",
    });
    expect(isSupportedBusinessTimezone("Asia/Singapore")).toBe(true);
    expect(isSupportedBusinessTimezone("Asia/Kuala_Lumpur")).toBe(true);
    expect(isSupportedBusinessTimezone("Australia/Sydney")).toBe(true);
    expect(new Set(BUSINESS_TIMEZONE_OPTIONS.map((option) => option.timezone)).size).toBe(BUSINESS_TIMEZONE_OPTIONS.length);
  });

  it("derives Berlin, Singapore, and New York dates from the same UTC instant", async () => {
    const now = new Date("2026-09-01T03:30:00Z");
    const clientFor = (timezone: string, countryCode: string) => ({
      teamGroup: {
        findUnique: async () => ({ countryCode, timezone, workStartMinutes: null, workEndMinutes: null, department }),
      },
    });

    await expect(resolveGroupBusinessDate("de", "Asia/Shanghai", now, clientFor("Europe/Berlin", "DE") as never)).resolves.toBe("2026-09-01");
    await expect(resolveGroupBusinessDate("sg", "Asia/Shanghai", now, clientFor("Asia/Singapore", "SG") as never)).resolves.toBe("2026-09-01");
    await expect(resolveGroupBusinessDate("us", "Asia/Shanghai", now, clientFor("America/New_York", "US") as never)).resolves.toBe("2026-08-31");
  });

  it("uses the IANA daylight-saving jump in New York", () => {
    expect(localClockMinutes(new Date("2026-03-08T06:30:00Z"), "America/New_York")).toBe(90);
    expect(localClockMinutes(new Date("2026-03-08T07:30:00Z"), "America/New_York")).toBe(210);
  });
});
