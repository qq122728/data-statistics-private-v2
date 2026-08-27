import { describe, expect, it } from "vitest";
import type { PerformanceLeaderboardRow } from "../../src/lib/analytics/performance-leaderboard-query";
import { buildDailyBossBrief } from "../../src/lib/boss-report/brief";
import { formatBossDailyBrief } from "../../src/lib/boss-report/format";

function row(overrides: Partial<PerformanceLeaderboardRow> = {}): PerformanceLeaderboardRow {
  return {
    groupId: "group-a",
    groupName: "A组",
    departmentId: "company-a",
    departmentName: "A公司",
    orders: 0,
    rechargeCents: 0,
    withdrawalCents: 0,
    netPerformanceCents: 0,
    costCents: 0,
    rebateCents: 0,
    profitCents: 0,
    newFans: 0,
    effectiveFans: 0,
    replies: 0,
    groupJoin: 0,
    expertIntro: 0,
    expertContacted: 0,
    registration: 0,
    noNumber: 0,
    duplicateFans: 0,
    matureNewFans: 0,
    matureOrders: 0,
    matureOrderRate: null,
    confirmedPeople: 0,
    activePeople: 0,
    risk: "LOW",
    ...overrides,
  };
}

const anomalies = {
  overdueExpertIntro: 3,
  overdueExpertContact: 2,
  overdueOrder: 1,
  invalidCustomers: 4,
  pendingCostGroups: 0,
};

describe("老板每日简报", () => {
  it("用累计快照差值计算当天数据，避免漏掉历史客户今天发生的转化", () => {
    const brief = buildDailyBossBrief({
      reportDate: "2026-08-16",
      generatedAt: new Date("2026-08-17T02:00:00Z"),
      previousRows: [row({ newFans: 100, effectiveFans: 80, replies: 40, groupJoin: 10, expertIntro: 5, orders: 1, rechargeCents: 10_000 })],
      currentRows: [row({ newFans: 120, effectiveFans: 96, replies: 50, groupJoin: 15, expertIntro: 8, expertContacted: 2, orders: 2, rechargeCents: 25_000, costCents: 2_000, profitCents: 23_000, netPerformanceCents: 25_000 })],
      anomalies,
    });

    expect(brief.totals).toMatchObject({ newFans: 20, effectiveFans: 16, replies: 10, groupJoin: 5, expertIntro: 3, expertContacted: 2, orders: 1, rechargeCents: 15_000 });
    expect(brief.rates.replyRate).toBeCloseTo(0.625);
    expect(brief.rates.joinRate).toBeCloseTo(0.5);
    expect(brief.hasData).toBe(true);
    expect(brief.topGroups[0]?.name).toBe("A组");
  });

  it("底料返点会从当天计入业绩中扣除，不能在老板日报中被误算为公司业绩", () => {
    const brief = buildDailyBossBrief({
      reportDate: "2026-08-16",
      generatedAt: new Date("2026-08-17T02:00:00Z"),
      previousRows: [row()],
      currentRows: [row({ rechargeCents: 800_000, rebateCents: 240_000, costCents: 0, profitCents: 560_000, netPerformanceCents: 800_000 })],
      anomalies,
    });

    expect(brief.totals).toMatchObject({ rechargeCents: 800_000, rebateCents: 240_000, profitCents: 560_000 });
  });

  it("TOP3 按扣除返点和成本后的计入业绩排序，并展示同一个金额", () => {
    const brief = buildDailyBossBrief({
      reportDate: "2026-08-16",
      previousRows: [],
      currentRows: [
        row({ groupId: "rebate", groupName: "底料组", rechargeCents: 100_000, netPerformanceCents: 100_000, rebateCents: 30_000, costCents: 0, profitCents: 70_000 }),
        row({ groupId: "sms", groupName: "短信组", rechargeCents: 80_000, netPerformanceCents: 80_000, costCents: 0, profitCents: 80_000 }),
      ],
      anomalies,
    });
    expect(brief.topGroups.map((item) => item.name)).toEqual(["短信组", "底料组"]);
    const message = formatBossDailyBrief(brief, null);
    expect(message.indexOf("短信组：计入业绩 $800.00")).toBeLessThan(message.indexOf("底料组：计入业绩 $700.00"));
  });

  it("空数据明确提示，不生成假分析", () => {
    const brief = buildDailyBossBrief({ reportDate: "2026-08-16", currentRows: [row()], previousRows: [row()], anomalies });
    const message = formatBossDailyBrief(brief, null);
    expect(brief.hasData).toBe(false);
    expect(message).toContain("今日暂无业务数据");
    expect(message).toContain("未生成 AI 分析");
  });

  it("日报展示真实统计、异常和AI建议", () => {
    const brief = buildDailyBossBrief({ reportDate: "2026-08-16", currentRows: [row({ newFans: 10, effectiveFans: 8, replies: 4 })], previousRows: [row()], anomalies });
    const message = formatBossDailyBrief(brief, { summary: "回复环节偏弱。", findings: ["回复率只有50%", "进群转化待观察", "提前退群需要核查"], actions: ["明天优先检查话术", "复盘未进群客户", "核查提前退群"] });
    expect(message).toContain("AI经营分析");
    expect(message).toContain("三个问题：");
    expect(message).toContain("三个行动：");
    expect(message).toContain("回复率 50.0%");
    expect(message).toContain("进群第 3 天仍未推专家：3");
  });
});
