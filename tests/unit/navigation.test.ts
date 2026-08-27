import { describe, expect, it } from "vitest";
import {
  getVisibleAppNavigation,
  getVisibleAppNavigationSections,
} from "../../src/lib/app-navigation";
import { getSafeNextPath } from "../../src/lib/navigation";

describe("post-login navigation", () => {
  it("uses the dashboard when there is no return path", () => {
    expect(getSafeNextPath(null, "https://stats.example")).toBe("/dashboard");
  });

  it("keeps an ordinary internal return path", () => {
    expect(
      getSafeNextPath("/reports?group=group-a#today", "https://stats.example"),
    ).toBe("/reports?group=group-a#today");
  });

  it("rejects the decoded backslash from an encoded open-redirect bypass", () => {
    // URLSearchParams decodes next=/%5Cevil.example to this value.
    expect(getSafeNextPath("/\\evil.example", "https://stats.example")).toBe(
      "/",
    );
  });

  it("maps each role to its visible application navigation", () => {
    expect(getVisibleAppNavigation("LEAD").map((item) => item.label)).toEqual([
      "组长工作台",
      "接粉明细",
      "无效粉审核",
      "专家管理",
      "炒群明细",
      "号码查询",
      "设备账号",
      "上下班打卡",
      "通知中心",
      "精英榜",
      "团队表现",
      "渠道与批次",
      "风险预警",
      "每日数据报表",
      "组员管理",
    ]);
    expect(getVisibleAppNavigation("ADMIN").map((item) => item.label)).toEqual([
      "总公司工作台",
      "上下班打卡",
      "通知中心",
      "炒群明细",
      "专家管理",
      "数据汇总",
      "完整榜单",
      "小组每日明细",
      "渠道表现",
      "精英榜",
      "公司组织管理",
      "管理员中心",
      "设备账号",
    ]);
    expect(getVisibleAppNavigation("RECEPTION").map((item) => item.label)).toEqual(
      ["设备账号", "上下班打卡", "通知中心", "接粉工作台", "个人数据", "精英榜"],
    );
    expect(getVisibleAppNavigation("GROUP_OPERATOR").map((item) => item.label)).toEqual(
      ["今日待办", "设备账号", "上下班打卡", "通知中心", "群内客户", "个人数据", "精英榜"],
    );
    expect(getVisibleAppNavigation("EXPERT").map((item) => item.label)).toEqual(
      ["今日待办", "设备账号", "上下班打卡", "通知中心", "专家客户情况", "个人数据", "精英榜"],
    );
    expect(getVisibleAppNavigation("RESOURCE_MANAGER").map((item) => item.label)).toEqual(["资源工作台", "通知中心", "精英榜", "渠道表现", "入群后跟进", "完整榜单", "成员每日明细", "风险预警", "渠道与单价"]);
    expect(getVisibleAppNavigation("COMPANY_MANAGER").map((item) => item.label)).toEqual(["公司工作台", "上下班打卡", "通知中心", "炒群明细", "专家管理", "数据汇总", "完整榜单", "小组每日明细", "渠道表现", "精英榜", "渠道与单价", "公司组织管理"]);
    expect(getVisibleAppNavigation("HR").map((item) => item.label)).toEqual(["人员档案", "考勤管理"]);
    expect(getVisibleAppNavigation("ADMIN").some((item) => item.href === "/device-accounts")).toBe(true);
  });

  it("shows both workstations exactly once for a reception and group-operation dual role", () => {
    const labels = getVisibleAppNavigation(["RECEPTION", "GROUP_OPERATOR"]).map((item) => item.label);

    expect(labels).toContain("接粉工作台");
    expect(labels).toContain("群内客户");
    expect(labels.filter((label) => label === "设备账号")).toHaveLength(1);
    expect(labels.filter((label) => label === "上下班打卡")).toHaveLength(1);
    expect(labels.filter((label) => label === "精英榜")).toHaveLength(1);
  });

  it("groups the lead navigation into task-oriented entries", () => {
    expect(
      getVisibleAppNavigationSections("LEAD").map((section) => ({
        label: section.label,
        items: section.items.map((item) => item.label),
      })),
    ).toEqual([
      {
        label: "日常工作",
        items: [
          "组长工作台",
          "接粉明细",
          "无效粉审核",
          "专家管理",
          "炒群明细",
          "号码查询",
          "设备账号",
          "上下班打卡",
          "通知中心",
        ],
      },
      {
        label: "数据分析",
        items: ["精英榜", "团队表现", "渠道与批次", "风险预警", "每日数据报表"],
      },
      { label: "人员管理", items: ["组员管理"] },
    ]);
  });

  it("gives the head office four task-oriented navigation groups", () => {
    expect(
      getVisibleAppNavigationSections("ADMIN").map((section) => ({
        label: section.label,
        collapsible: Boolean(section.collapsible),
        items: section.items.map((item) => item.label),
      })),
    ).toEqual([
      { label: "日常工作", collapsible: false, items: ["总公司工作台", "上下班打卡", "通知中心"] },
      { label: "客户流程", collapsible: true, items: ["炒群明细", "专家管理"] },
      { label: "经营分析", collapsible: true, items: ["数据汇总", "完整榜单", "小组每日明细"] },
      { label: "渠道分析", collapsible: true, items: ["渠道表现"] },
      { label: "", collapsible: false, items: ["精英榜"] },
      { label: "组织与系统", collapsible: true, items: ["公司组织管理", "管理员中心", "设备账号"] },
    ]);
  });

  it("keeps the company manager sidebar in its expected sections", () => {
    expect(
      getVisibleAppNavigationSections("COMPANY_MANAGER").map((section) => ({
        label: section.label,
        collapsible: Boolean(section.collapsible),
        items: section.items.map((item) => item.label),
      })),
    ).toEqual([
      { label: "", collapsible: false, items: ["公司工作台", "上下班打卡", "通知中心"] },
      { label: "客户管理", collapsible: true, items: ["炒群明细", "专家管理"] },
      { label: "数据中心", collapsible: true, items: ["数据汇总", "完整榜单", "小组每日明细"] },
      { label: "渠道分析", collapsible: true, items: ["渠道表现"] },
      { label: "", collapsible: false, items: ["精英榜"] },
      { label: "资源设置", collapsible: false, items: ["渠道与单价"] },
      { label: "", collapsible: false, items: ["公司组织管理"] },
    ]);
  });
});
