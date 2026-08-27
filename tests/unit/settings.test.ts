import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import {
  getSystemSettings,
  parseSystemSettings,
  resolveReportView,
  updateSystemSettings,
} from "../../src/lib/settings";

const settingKeys = [
  "appName",
  "timezone",
  "defaultReportMode",
  "allowMemberChannelCreation",
] as const;

afterEach(async () => {
  await db.auditLog.deleteMany({ where: { actorId: "admin-1", action: "SYSTEM_SETTINGS_UPDATED" } });
  await db.systemSetting.deleteMany({ where: { key: { in: [...settingKeys] } } });
});

describe("system settings", () => {
  it("rejects an unknown default report mode", () => {
    expect(parseSystemSettings({ defaultReportMode: "bad" })).toEqual({
      success: false,
      error: "默认报表模式不正确",
    });
  });

  it("accepts supported values for all settings", () => {
    expect(parseSystemSettings({
      appName: "团队数据统计",
      timezone: "Asia/Shanghai",
      defaultReportMode: "cumulative",
      allowMemberChannelCreation: true,
    })).toEqual({
      success: true,
      data: {
        appName: "团队数据统计",
        timezone: "Asia/Shanghai",
        defaultReportMode: "cumulative",
        allowMemberChannelCreation: true,
      },
    });
  });

  it("persists every setting and records only the changed keys", async () => {
    await updateSystemSettings({
      appName: "团队数据统计",
      timezone: "Asia/Shanghai",
      defaultReportMode: "incremental",
      allowMemberChannelCreation: false,
    }, "admin-1");

    await expect(getSystemSettings()).resolves.toEqual({
      appName: "团队数据统计",
      timezone: "Asia/Shanghai",
      defaultReportMode: "incremental",
      allowMemberChannelCreation: false,
    });
    await expect(db.auditLog.findFirst({
      where: { actorId: "admin-1", action: "SYSTEM_SETTINGS_UPDATED" },
    })).resolves.toMatchObject({
      entityType: "SystemSetting",
      entityId: "system",
      summary: JSON.stringify({ changedKeys: ["appName", "defaultReportMode"] }),
    });
  });

  it("applies the configured report mode and business timezone on first open", () => {
    expect(resolveReportView({}, {
      defaultReportMode: "incremental",
      timezone: "Asia/Shanghai",
    }, new Date("2026-08-11T18:00:00.000Z"))).toEqual({
      mode: "incremental",
      occurredDateFrom: "2026-08-12",
      occurredDateTo: "2026-08-12",
    });
  });

  it("lets an explicit cumulative report ignore old occurrence dates", () => {
    expect(resolveReportView({
      mode: "cumulative",
      occurredDateFrom: "2026-08-01",
      occurredDateTo: "2026-08-11",
    }, {
      defaultReportMode: "incremental",
      timezone: "Asia/Shanghai",
    })).toEqual({ mode: "cumulative" });
  });
});
