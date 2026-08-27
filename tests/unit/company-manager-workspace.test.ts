import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyCommandCenter } from "../../src/components/analytics/overview/CompanyCommandCenter";
import type { CompanyWorkspace } from "../../src/lib/analytics/company-workspace";
import { emptyBatchTotals } from "../../src/lib/metrics";

const metric = (completed: number, eligible: number, grade: "BELOW_PASS" | "PASS" | "GOOD" | "EXCELLENT") => ({
  completed,
  eligible,
  rate: completed / eligible,
  grade,
  band: { pass: 10, good: 15, excellent: 20 },
});

const workspace: CompanyWorkspace = {
  resource: {
    quality: {
      submitted: 100,
      effective: 80,
      replies: 40,
      duplicate: 10,
      invalid: 10,
      lowAmount: 3,
      noWs: 4,
      effectiveRate: 0.8,
      customerReplyRate: 0.5,
      duplicateRate: 0.1,
      invalidRate: 0.1,
      costCents: 10_000,
      costPerEffectiveCents: 125,
      matureSample: 60,
      matureOrders: 6,
      matureOrderRate: 0.1,
    },
    execution: {
      receptionReply: { eligible: 80, completed: 70, rate: 0.875 },
      receptionJoin: { eligible: 40, completed: 20, rate: 0.5 },
      operatorExpert: { eligible: 20, completed: 14, rate: 0.7 },
      expertOrder: { eligible: 14, completed: 6, rate: 6 / 14 },
    },
    groups: [],
    daily: [],
  },
  seriousOverdue: { eligible: 30, count: 4, rate: 4 / 30 },
  groups: [{
    groupId: "group-a",
    groupName: "一组",
    effectiveRate: 0.8,
    resourceStatus: "NORMAL",
    reception: metric(18, 100, "GOOD"),
    operator: metric(54, 100, "BELOW_PASS"),
    expert: metric(12, 100, "PASS"),
    netContributionCents: 35_000,
    seriousOverdue: 4,
    status: "DANGER",
  }],
  attention: [{ key: "group-a", groupId: "group-a", tone: "danger", title: "一组 · 炒群推专家不及格", detail: "严重超时 4 人 · 当前 54.0%" }],
};

describe("company manager workspace", () => {
  it("renders a compact company result, flow, group health and attention view", () => {
    const html = renderToStaticMarkup(createElement(CompanyCommandCenter, {
      overview: {
        hasData: true,
        totals: { ...emptyBatchTotals(), effectiveFans: 80, groupJoin: 30, expertIntro: 18, registration: 10, orders: 6 },
        summary: { newFans: 100, orders: 6, rechargeCents: 50_000, financialRechargeCents: 50_000, profitCents: 35_000, orderRate: 0.06 },
        trend: [],
        largestDrop: null,
        alerts: { unconfirmed: [], noRecords3Days: [], replyWithoutFans: [], funnelAnomalies: [], excessiveLeaves: [] },
      },
      workspace,
      filters: { sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16" },
    }));

    for (const text of ["资源成本", "入金", "净业绩", "计入业绩", "D7添加数据开单率", "严重超时客户率", "整体流程", "小组健康表", "进群率", "第3天推专家率", "第2天开单率", "重点关注", "$350.00"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("盈亏");
    expect(html).not.toMatch(/1\d{10}/);
  });

  it("loads the company-only workspace only for the company manager branch", () => {
    const source = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
    expect(source).toContain("isCompanyManager ? loadCompanyWorkspace(scope, today) : Promise.resolve(null)");
    expect(source).toContain("isCompanyManager && companyWorkspace");
    expect(source).toContain("<CompanyCommandCenter");
  });
});
