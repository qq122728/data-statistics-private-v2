import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeadquartersCommandCenter } from "../../src/components/analytics/overview/HeadquartersCommandCenter";
import { emptyBatchTotals } from "../../src/lib/metrics";

describe("headquarters command center", () => {
  it("shows globally ranked group results with company and country labels, without customer numbers", () => {
    const overview = {
      hasData: true,
      totals: { ...emptyBatchTotals(), newFans: 100, effectiveFans: 80, orders: 8, rechargeCents: 120_000 },
      summary: { newFans: 100, orders: 8, rechargeCents: 120_000, orderRate: 0.08, financialRechargeCents: 120_000, withdrawalCents: 20_000, costCents: 30_000, rebateCents: 0, profitCents: 70_000, matureNewFans: 50, matureOrders: 5, matureOrderRate: 0.1 },
      trend: [],
      largestDrop: null,
      groupComparison: [{
        groupId: "group-a", groupName: "A组", departmentId: "company-a", departmentName: "A公司",
        orders: 8, rechargeCents: 120_000, withdrawalCents: 20_000, netPerformanceCents: 100_000,
        costCents: 30_000, rebateCents: 0, profitCents: 70_000, newFans: 100, effectiveFans: 80, replies: 60,
        groupJoin: 30, groupLeave: 6, expertIntro: 20, expertContacted: 15, registration: 10, noNumber: 10,
        duplicateFans: 10, matureNewFans: 50, matureOrders: 5, matureOrderRate: 0.1,
        confirmedPeople: 2, activePeople: 3, risk: "LOW" as const,
      }],
      alerts: { unconfirmed: [{ userId: "u1", name: "员工甲", reason: "今日尚未确认数据", count: 1 }], noRecords3Days: [], replyWithoutFans: [], funnelAnomalies: [], excessiveLeaves: [], unassignedExperts: [], registrationOverdue: [], orderOverdue: [], planOverdue: [] },
    };

    const html = renderToStaticMarkup(createElement(HeadquartersCommandCenter, { overview, filters: { sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16" } }));
    for (const text of ["总公司经营总览", "全部小组业绩排行", "小组流程对比", "需要总公司关注", "下属公司", "国家", "回复率", "退群率", "推专家率", "联系率", "查看小组"]) expect(html).toContain(text);
    expect(html).toContain("groupId=group-a");
    expect(html).not.toMatch(/\d{10,}/);
  });
});
