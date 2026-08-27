import { describe, expect, it } from "vitest";
import {
  buildVerifiedProblems,
  selectEmployeeFunnelsForAi,
} from "../../src/lib/boss-report/candidates";
import type { BossEmployeeFunnel, DailyBossBrief } from "../../src/lib/boss-report/types";

function employee(index: number, ratePercent: number, sample = 20): BossEmployeeFunnel {
  return {
    employeeId: `employee-${index}`,
    role: "接粉",
    name: `员工${index}`,
    groupName: "A公司 / A组",
    sample,
    sampleState: sample >= 20 ? "RANKABLE" : "INSUFFICIENT",
    stages: { validFans: sample, joined: Math.round(sample * ratePercent / 100) },
    evaluation: {
      metric: "有效数据入群率",
      completed: Math.round(sample * ratePercent / 100),
      eligible: sample,
      ratePercent,
      grade: ratePercent < 10 ? "BELOW_PASS" : "PASS",
      gradeLabel: ratePercent < 10 ? "不及格" : "及格",
      standard: { pass: 10, good: 15, excellent: 20 },
    },
  };
}

function brief(employeeFunnels: BossEmployeeFunnel[], confirmedFrontline = 100): DailyBossBrief {
  const totals = { newFans: 1, effectiveFans: 1, replies: 0, groupJoin: 0, expertIntro: 0, expertContacted: 0, registration: 0, orders: 0, rechargeCents: 0, withdrawalCents: 0, netPerformanceCents: 0, costCents: 0, rebateCents: 0, profitCents: 0 };
  const rates = { replyRate: 0, joinRate: null, expertIntroRate: null, expertContactRate: null, expertOrderRate: null };
  return {
    reportDate: "2026-08-16",
    generatedAt: "2026-08-17T02:00:00.000Z",
    hasData: true,
    totals,
    rates,
    topCompanies: [],
    topGroups: [],
    groupRows: [],
    anomalies: { overdueExpertIntro: 0, overdueExpertContact: 0, overdueOrder: 0, invalidCustomers: 0, pendingCostGroups: 0 },
    aiContext: {
      headlinePeriod: { type: "DAILY", date: "2026-08-16" },
      analysisWindow: { from: "2026-07-18", to: "2026-08-16" },
      dataCompleteness: { activeFrontline: 100, confirmedFrontline, confirmationRate: confirmedFrontline / 100 },
      comparison: { yesterday: { totals, rates }, trailing7DayAverage: { totals, rates } },
      employeeFunnels,
      channelQuality: [],
      verifiedProblems: [],
      leavesToday: {
        day1To8Abnormal: { total: 0, withOrder: 0, withoutOrder: 0 },
        day9To13Watch: { total: 0, withOrder: 0, withoutOrder: 0 },
        day14PlusNormal: { total: 0, withOrder: 0, withoutOrder: 0 },
        dateMissing: { total: 0, withOrder: 0, withoutOrder: 0 },
      },
    },
  };
}

describe("老板简报候选筛选", () => {
  it("上百员工只送有限候选给AI，但保留低量严重异常员工", () => {
    const rows = Array.from({ length: 100 }, (_, index) => employee(index, index === 99 ? 0 : 12, index === 99 ? 20 : 100 + index));
    const selected = selectEmployeeFunnelsForAi(rows);
    expect(selected).toHaveLength(6);
    expect(selected.some((row) => row.employeeId === "employee-99")).toBe(true);
  });

  it("数据未确认完整时不评价员工，只先提示补数据", () => {
    const report = brief([employee(1, 0)], 80);
    const problems = buildVerifiedProblems(report);
    expect(problems[0]?.category).toBe("DATA_COMPLETENESS");
    expect(problems.some((problem) => problem.category === "EMPLOYEE_CONVERSION")).toBe(false);
    expect(problems).toHaveLength(3);
  });

  it("数据完整后使用程序评级生成准确问题句", () => {
    const problems = buildVerifiedProblems(brief([employee(1, 5)]));
    expect(problems[0]?.display).toContain("5.0%");
    expect(problems[0]?.display).toContain("低于及格线 10%");
  });
});
