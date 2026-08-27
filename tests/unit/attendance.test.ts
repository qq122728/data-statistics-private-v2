import { describe, expect, it } from "vitest";
import { clockInStatus, clockOutStatus, canUseAttendance } from "../../src/lib/attendance";

const berlinSchedule = {
  countryCode: "DE",
  timezone: "Europe/Berlin",
  workStartMinutes: 10 * 60,
  workEndMinutes: 22 * 60,
};

describe("attendance rules", () => {
  it("allows frontline roles and group leads to use attendance", () => {
    expect(canUseAttendance("RECEPTION")).toBe(true);
    expect(canUseAttendance("GROUP_OPERATOR")).toBe(true);
    expect(canUseAttendance("EXPERT")).toBe(true);
    expect(canUseAttendance("LEAD")).toBe(true);
    expect(canUseAttendance("ADMIN")).toBe(false);
  });

  it("classifies late arrival and early leave in the group's local timezone", () => {
    expect(clockInStatus(berlinSchedule, new Date("2026-08-17T07:59:00Z"))).toBe("NORMAL");
    expect(clockInStatus(berlinSchedule, new Date("2026-08-17T08:01:00Z"))).toBe("LATE");
    expect(clockOutStatus(berlinSchedule, new Date("2026-08-17T19:59:00Z"))).toBe("EARLY");
    expect(clockOutStatus(berlinSchedule, new Date("2026-08-17T20:00:00Z"))).toBe("NORMAL");
  });
});
