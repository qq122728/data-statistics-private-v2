import { describe, expect, it } from "vitest";
import { dueGroupDailySchedules } from "../../src/lib/group-daily-schedule";

const group = { id: "g1", name: "测试组", timezone: "UTC", workEndMinutes: 22 * 60 };

describe("小组日报自动推送时间", () => {
  it("只在下班后一小时开始的重试窗口内到期", () => {
    expect(dueGroupDailySchedules([group], new Date("2026-09-01T22:59:00Z"))).toHaveLength(0);
    expect(dueGroupDailySchedules([group], new Date("2026-09-01T23:00:00Z"))).toHaveLength(1);
    expect(dueGroupDailySchedules([group], new Date("2026-09-01T23:29:00Z"))).toHaveLength(1);
    expect(dueGroupDailySchedules([group], new Date("2026-09-01T23:30:00Z"))).toHaveLength(0);
  });

  it("正确处理跨午夜的下班时间", () => {
    const late = { ...group, workEndMinutes: 23 * 60 + 30 };
    expect(dueGroupDailySchedules([late], new Date("2026-09-02T00:29:00Z"))).toHaveLength(0);
    expect(dueGroupDailySchedules([late], new Date("2026-09-02T00:30:00Z"))).toHaveLength(1);
  });
});
