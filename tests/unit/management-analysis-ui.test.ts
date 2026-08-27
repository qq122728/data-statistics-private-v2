import * as React from "react";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { TodayConfirmation } from "../../src/components/analytics/TodayConfirmation";
import { BatchReportTable } from "../../src/components/reports/BatchReportTable";
import { RoleRankingsTable } from "../../src/components/analytics/RoleRankingsTable";
import { AppHeader } from "../../src/components/shell/AppHeader";
import { AppSidebar } from "../../src/components/shell/AppSidebar";

(globalThis as { React?: typeof React }).React = React;

type TodayConfirmationProps = ComponentProps<typeof TodayConfirmation>;
// @ts-expect-error A caller must explicitly provide the authenticated role.
const missingConfirmationRole: TodayConfirmationProps = {
  businessDate: "2026-08-12",
};
void missingConfirmationRole;

describe("management analysis interface behavior", () => {
  it("uses the member dashboard title while leads see their management workspace", () => {
    const baseProps = {
      appName: "数据台",
      userName: "测试用户",
      groupName: "一组",
      timezone: "Asia/Shanghai",
    };
    const member = renderToStaticMarkup(
      createElement(AppHeader, {
        ...baseProps,
        role: "RECEPTION",
        roleLabel: "成员",
      }),
    );
    const lead = renderToStaticMarkup(
      createElement(AppHeader, {
        ...baseProps,
        role: "LEAD",
        roleLabel: "组长",
      }),
    );

    expect(member).toContain("今日待办");
    expect(member).not.toContain("管理概览");
    expect(lead).toContain("组长工作台");
    expect(lead).not.toContain("管理概览");
  });

  it("does not render a confirmation control for administrators", () => {
    const admin = renderToStaticMarkup(
      createElement(TodayConfirmation, {
        businessDate: "2026-08-12",
        role: "ADMIN",
      }),
    );
    const lead = renderToStaticMarkup(
      createElement(TodayConfirmation, {
        businessDate: "2026-08-12",
        role: "LEAD",
      }),
    );

    expect(admin).toBe("");
    expect(lead).toContain("确认今日数据已填写完成");
    expect(lead).toContain("bg-[#0b66ff]");
  });

  it("renders a persisted confirmation for an ordinary member after a page refresh", () => {
    const member = renderToStaticMarkup(
      createElement(TodayConfirmation, {
        businessDate: "2026-08-12",
        initialConfirmedAt: "2026-08-12T04:30:00.000Z",
        role: "RECEPTION",
      }),
    );

    expect(member).toContain("已确认");
    expect(member).toContain("disabled");
    expect(member).not.toContain("确认今日数据已填写完成");
  });

  it("renders grouped sidebar structure for a lead", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        appName: "数据台",
        user: { name: "组长", role: "LEAD", roleLabel: "组长" },
      }),
    );

    expect(html.match(/app-nav-section-label/g)).toHaveLength(3);
    expect(html).toContain('class="app-nav-section"');
    // 移除“老客户补录”后，保留现有日常、数据分析和人员管理入口。
    expect(html.match(/class="app-nav-link"/g)).toHaveLength(15);
    expect(html).toContain("精英榜");
    expect(html).toContain("炒群明细");
    expect(html).toContain("号码查询");
    expect(html).not.toContain("老客户补录");
    expect(html).toContain("无效粉审核");
    expect(html).toContain("团队表现");
    expect(html).toContain("渠道与批次");
    expect(html).toContain("每日数据报表");
    expect(html).toContain("组员管理");
    expect(html).not.toContain("组员对比");
    expect(html).not.toContain("成员明细");
  });

  it("shows the small group as a separate role-ranking column", () => {
    const html = renderToStaticMarkup(
      createElement(RoleRankingsTable, {
        result: {
          reception: [{ id: "r1", name: "接粉一", active: true, groupId: "g1", groupName: "西瓜组", valid: 1, replied: 1, joined: 1, expertIntroduced: 0, registered: 0, orders: 0, firstDepositCents: 0, depositCents: 0, withdrawalCents: 0, costCents: 0, profitCents: 0 }],
          groupOperators: [],
          experts: [],
          groups: [],
          standardsByGroup: { g1: { receptionJoin: { pass: 10, good: 15, excellent: 20 }, operatorExpert: { pass: 60, good: 70, excellent: 80 }, expertOrder: { pass: 10, good: 15, excellent: 20 } } },
        },
      }),
    );

    expect(html).toContain("<th>接粉成员</th><th>小组</th>");
    expect(html).toContain(">西瓜组</span>");
    expect(html).not.toContain("接粉成员 / 小组");
  });

  it("keeps the incremental net-in-group heading when no rows match", () => {
    const html = renderToStaticMarkup(
      createElement(BatchReportTable, { mode: "incremental", rows: [] }),
    );
    expect(html).toContain("本期净增在群");
    expect(html).not.toContain(">在群<");
  });
});
