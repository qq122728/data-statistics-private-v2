import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourceCommandCenter } from "../../src/components/analytics/overview/ResourceCommandCenter";
import { emptyBatchTotals } from "../../src/lib/metrics";

describe("resource manager workspace", () => {
  it("separates resource quality from employee execution and daily meanings", () => {
    const html = renderToStaticMarkup(createElement(ResourceCommandCenter, {
      overview: {
        hasData: true,
        totals: emptyBatchTotals(),
        summary: { newFans: 100, orders: 8, rechargeCents: 50_000, orderRate: 0.08, financialRechargeCents: 50_000, netPerformanceCents: 35_000 },
        trend: [], largestDrop: null,
        alerts: { unconfirmed: [], noRecords3Days: [], replyWithoutFans: [], funnelAnomalies: [], excessiveLeaves: [], unassignedExperts: [], registrationOverdue: [], orderOverdue: [], planOverdue: [] },
      },
      workspace: {
        quality: { submitted: 100, effective: 80, replies: 40, duplicate: 10, invalid: 10, lowAmount: 3, noWs: 4, effectiveRate: 0.8, customerReplyRate: 0.5, duplicateRate: 0.1, invalidRate: 0.1, matureSample: 60, matureOrders: 6, matureOrderRate: 0.1 },
        execution: {
          receptionReply: { eligible: 80, completed: 70, rate: 0.875 },
          receptionJoin: { eligible: 40, completed: 20, rate: 0.5 },
          operatorExpert: { eligible: 20, completed: 14, rate: 0.7 },
          expertOrder: { eligible: 14, completed: 6, rate: 6 / 14 },
        },
        groups: [], daily: [],
      },
      filters: { sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16" },
      dailyMode: "source",
    }));
    for (const text of ["资源质量", "撞粉率", "低金额", "无 WS 号码", "回复率", "员工执行", "接粉按时回复率", "小组每日数据", "来源批次", "当日执行"]) expect(html).toContain(text);
    expect(html).not.toContain("人工无效");
    expect(html).not.toContain("¥");
  });

  it("keeps joined-customer access read-only and only renders a six-digit phone tail", () => {
    const source = readFileSync("src/app/(app)/resource-conversion/page.tsx", "utf8");
    expect(source).toContain('if (user.role !== "RESOURCE_MANAGER") redirect("/dashboard")');
    expect(source).toContain('SELECT "id", substr("phone", -6) AS "phoneTail"');
    expect(source).toContain('FROM "LeadCustomer"');
    expect(source).not.toContain("phone: true");
    expect(source).toContain("•••• {lead.phoneTail}");
    expect(source).not.toContain("{lead.phone}");
    expect(source).not.toMatch(/fetch\([^)]*api\/(?:leads|customer)/);
    expect(source).not.toContain("<button>修改");
  });
});
