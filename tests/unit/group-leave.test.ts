import { describe, expect, it } from "vitest";
import { assessGroupLeave, leaveOrderLabel } from "../../src/lib/group-leave";

describe("退群分层", () => {
  it("进群当天算第1天，并把第1至8天标为异常", () => {
    expect(assessGroupLeave("2026-08-01", "2026-08-01")).toMatchObject({ dayNumber: 1, level: "EARLY" });
    expect(assessGroupLeave("2026-08-01", "2026-08-08")).toMatchObject({ dayNumber: 8, level: "EARLY" });
  });

  it("第9至13天为观察，第14天起为正常", () => {
    expect(assessGroupLeave("2026-08-01", "2026-08-09")).toMatchObject({ dayNumber: 9, level: "WATCH" });
    expect(assessGroupLeave("2026-08-01", "2026-08-13")).toMatchObject({ dayNumber: 13, level: "WATCH" });
    expect(assessGroupLeave("2026-08-01", "2026-08-14")).toMatchObject({ dayNumber: 14, level: "NORMAL" });
  });

  it("缺日期时要求核对，并区分是否有有效开单", () => {
    expect(assessGroupLeave(null, "2026-08-14").level).toBe("UNKNOWN");
    expect(leaveOrderLabel(true)).toBe("已开单退群");
    expect(leaveOrderLabel(false)).toBe("未开单退群");
  });
});
