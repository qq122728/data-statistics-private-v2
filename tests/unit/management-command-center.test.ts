import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManagementCommandCenter } from "../../src/components/analytics/overview/ManagementCommandCenter";
import { getVisibleAppNavigation } from "../../src/lib/app-navigation";
import { emptyBatchTotals } from "../../src/lib/metrics";

describe("role-specific management command center", () => {
  const overview = {
    hasData: true,
    totals: { ...emptyBatchTotals(), newFans: 20, replies: 10, effectiveFans: 18 },
    summary: {
      newFans: 20,
      orders: 2,
      rechargeCents: 50_000,
      orderRate: 0.1,
      withdrawalCents: 10_000,
      costCents: 5_000,
      rebateCents: 0,
      profitCents: 35_000,
      matureNewFans: 20,
      matureOrders: 2,
      matureOrderRate: 0.1,
    },
    trend: [],
    largestDrop: { from: "NEW_FANS" as const, to: "REPLIES" as const, lost: 10 },
    groupComparison: [{
      groupId: "group-a",
      groupName: "A组",
      departmentId: "department-a",
      departmentName: "A部门",
      orders: 2,
      rechargeCents: 50_000,
      withdrawalCents: 10_000,
      netPerformanceCents: 40_000,
      costCents: 5_000,
      rebateCents: 0,
      profitCents: 35_000,
      effectiveFans: 18,
      matureNewFans: 20,
      matureOrders: 2,
      matureOrderRate: 0.1,
      confirmedPeople: 1,
      activePeople: 2,
      risk: "LOW" as const,
    }],
    alerts: {
      unconfirmed: [], noRecords3Days: [], replyWithoutFans: [], funnelAnomalies: [], excessiveLeaves: [],
      unassignedExperts: [], registrationOverdue: [], orderOverdue: [], planOverdue: [],
    },
  };

  it("shows the selected profit equation, mature denominator, comparison and funnel", () => {
    const html = renderToStaticMarkup(createElement(ManagementCommandCenter, { overview, filters: {}, role: "ADMIN" }));
    for (const text of ["单量榜 TOP 3", "业绩榜 TOP 3", "入金", "出金", "数据成本", "计入业绩", "$350.00", "D7添加数据开单率", "开单 2 / 成熟添加数据 20", "下属公司与小组对比", "整体转化漏斗", "最大掉点：添加数据 → 回复"]) expect(html).toContain(text);
    expect(html).not.toContain("¥");
  });

  it("gives resource managers a real landing page without expanding their write access", () => {
    const navigation = getVisibleAppNavigation("RESOURCE_MANAGER");
    expect(navigation).toEqual([
      { href: "/dashboard", label: "资源工作台" },
      { href: "/notifications", label: "通知中心" },
      { href: "/performance-leaderboard", label: "精英榜" },
      { href: "/channel-analysis", label: "渠道表现" },
      { href: "/resource-conversion", label: "入群后跟进" },
      { href: "/role-rankings", label: "完整榜单" },
      { href: "/anomaly-ranking", label: "成员每日明细" },
      { href: "/anomaly-ranking?tab=risk", label: "风险预警" },
      { href: "/resource-channels", label: "渠道与单价" },
    ]);
  });
});
