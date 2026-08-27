import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("统一二次确认", () => {
  it("不再使用浏览器原生确认框", async () => {
    const [device, entry] = await Promise.all([
      read("src/components/device-accounts/DeviceAccountManager.tsx"),
      read("src/components/entry/EntryTabs.tsx"),
    ]);
    expect(device).not.toContain("window.confirm");
    expect(entry).not.toContain("window.confirm");
    expect(entry).not.toContain("window.prompt");
  });

  it("会对容易误点的写入操作显示统一确认窗口", async () => {
    const [attendance, today, device, collaboration, standards, riskSettings, dialog] = await Promise.all([
      read("src/components/attendance/AttendancePanel.tsx"),
      read("src/components/analytics/TodayConfirmation.tsx"),
      read("src/components/device-accounts/DeviceAccountManager.tsx"),
      read("src/components/lead-members/CollaborationSettings.tsx"),
      read("src/components/lead/ConversionStandardsPanel.tsx"),
      read("src/components/admin/RiskSettingsForm.tsx"),
      read("src/components/ui/WorkflowConfirmationDialog.tsx"),
    ]);
    for (const source of [attendance, today, device, collaboration, standards, riskSettings]) {
      expect(source).toContain("WorkflowConfirmationDialog");
    }
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain('event.key !== "Tab"');
    expect(dialog).toContain("previousFocusRef.current?.focus()");
  });
});
