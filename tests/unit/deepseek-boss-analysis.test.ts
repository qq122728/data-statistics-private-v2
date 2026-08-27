import { describe, expect, it, vi } from "vitest";
import { generateBossAiAnalysis } from "../../src/lib/boss-report/deepseek";
import type { DailyBossBrief } from "../../src/lib/boss-report/types";

const brief: DailyBossBrief = {
  reportDate: "2026-08-16",
  generatedAt: "2026-08-17T02:00:00.000Z",
  hasData: true,
  totals: { newFans: 10, effectiveFans: 8, replies: 4, groupJoin: 1, expertIntro: 0, expertContacted: 0, registration: 0, orders: 0, rechargeCents: 0, withdrawalCents: 0, netPerformanceCents: 0, costCents: 1000, rebateCents: 0, profitCents: -1000 },
  rates: { replyRate: 0.5, joinRate: 0.25, expertIntroRate: 0, expertContactRate: null, expertOrderRate: null },
  topCompanies: [{ name: "A公司", orders: 0, netPerformanceCents: 0, profitCents: -1000 }],
  topGroups: [{ name: "A组", departmentName: "A公司", orders: 0, netPerformanceCents: 0, profitCents: -1000 }],
  groupRows: [],
  anomalies: { overdueExpertIntro: 1, overdueExpertContact: 0, overdueOrder: 0, invalidCustomers: 2, pendingCostGroups: 0 },
  aiContext: {
    headlinePeriod: { type: "DAILY", date: "2026-08-16" },
    analysisWindow: { from: "2026-07-18", to: "2026-08-16" },
    dataCompleteness: { activeFrontline: 3, confirmedFrontline: 3, confirmationRate: 1 },
    comparison: {
      yesterday: { totals: { newFans: 8, effectiveFans: 6, replies: 3, groupJoin: 1, expertIntro: 0, expertContacted: 0, registration: 0, orders: 0, rechargeCents: 0, withdrawalCents: 0, netPerformanceCents: 0, costCents: 800, rebateCents: 0, profitCents: -800 }, rates: { replyRate: 0.5, joinRate: 1 / 3, expertIntroRate: 0, expertContactRate: null, expertOrderRate: null } },
      trailing7DayAverage: { totals: { newFans: 9, effectiveFans: 7, replies: 3.5, groupJoin: 1, expertIntro: 0, expertContacted: 0, registration: 0, orders: 0, rechargeCents: 0, withdrawalCents: 0, netPerformanceCents: 0, costCents: 900, rebateCents: 0, profitCents: -900 }, rates: { replyRate: 0.5, joinRate: 2 / 7, expertIntroRate: 0, expertContactRate: null, expertOrderRate: null } },
    },
    employeeFunnels: [{
      employeeId: "employee-a",
      role: "接粉",
      name: "员工甲",
      groupName: "A公司 / A组",
      sample: 20,
      sampleState: "RANKABLE",
      stages: { validFans: 20, replied: 10, joined: 1 },
      evaluation: {
        metric: "有效数据入群率",
        completed: 1,
        eligible: 20,
        ratePercent: 5,
        grade: "BELOW_PASS",
        gradeLabel: "不及格",
        standard: { pass: 10, good: 15, excellent: 20 },
      },
    }],
    channelQuality: [],
    verifiedProblems: [
      { id: "flow:intro", category: "CUSTOMER_FLOW", severity: 3, target: "推专家逾期", display: "进群第3天仍未推专家：1位", actionHint: "逐个核查", facts: { count: 1 } },
      { id: "employee:reception", category: "EMPLOYEE_CONVERSION", severity: 2, target: "员工甲", display: "员工甲有效数据入群率低于及格线", actionHint: "复盘未进群样本", facts: { ratePercent: 5 } },
      { id: "observation:1", category: "OBSERVATION", severity: 0, target: "渠道观察", display: "渠道暂未发现明显异常", actionHint: "继续观察", facts: {} },
    ],
    leavesToday: {
      day1To8Abnormal: { total: 1, withOrder: 0, withoutOrder: 1 },
      day9To13Watch: { total: 0, withOrder: 0, withoutOrder: 0 },
      day14PlusNormal: { total: 0, withOrder: 0, withoutOrder: 0 },
      dateMissing: { total: 0, withOrder: 0, withoutOrder: 0 },
    },
  },
};

describe("DeepSeek 老板分析", () => {
  it("只发送脱敏汇总并解析 JSON 分析", async () => {
    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const content = request.messages[1].content as string;
      expect(content).toContain("A公司");
      expect(content).toContain('"verifiedProblems"');
      expect(content).toContain('"leavesToday"');
      expect(content).toContain('"rechargeUsd"');
      expect(content).toContain('"creditedPerformanceUsd"');
      expect(content).not.toContain('"profitUsd"');
      expect(content).not.toContain("员工甲");
      expect(content).not.toContain('"rechargeCents"');
      expect(content).not.toContain('"phone"');
      expect(content).not.toContain('"customerName"');
      expect(content).not.toContain("13800138000");
      expect(request.messages[0].content).toContain("只能写美元或使用 $");
      expect(request.messages[0].content).toContain("禁止写元、人民币或 ¥");
      expect(request.messages[0].content).toContain("effectiveFans 只能叫有效数据");
      expect(request.messages[0].content).toContain("replyRate 叫回复率（回复÷有效数据）");
      expect(request.messages[0].content).toContain("creditedPerformanceUsd 是计入业绩");
      expect(request.response_format).toEqual({ type: "json_object" });
      expect(request.thinking).toEqual({ type: "disabled" });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        summary: "当前应优先处理流程推进和员工转化问题",
        actions: [
          { candidateId: "flow:intro", action: "逐个核查逾期客户并记录原因" },
        { candidateId: "employee:reception", action: "复盘未进群样本并检查话术" },
          { candidateId: "observation:1", action: "保持观察并核对后续变化" },
        ],
      }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const result = await generateBossAiAnalysis(brief, { apiKey: "test-only", fetchImplementation: mockFetch as typeof fetch });
    expect(result).toEqual({
      summary: "当前应优先处理流程推进和员工转化问题",
      findings: ["进群第3天仍未推专家：1位", "员工甲有效数据入群率低于及格线", "渠道暂未发现明显异常"],
      actions: [
        "推专家逾期：逐个核查逾期客户并记录原因",
        "员工甲：复盘未进群样本并检查话术",
        "渠道观察：保持观察并核对后续变化",
      ],
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("AI连续失败时返回空，不影响真实日报", async () => {
    const mockFetch = vi.fn(async () => new Response("error", { status: 500 }));
    const result = await generateBossAiAnalysis(brief, { apiKey: "test-only", fetchImplementation: mockFetch as typeof fetch });
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("没有业务数据时不消耗DeepSeek额度", async () => {
    const mockFetch = vi.fn();
    const result = await generateBossAiAnalysis({ ...brief, hasData: false }, { apiKey: "test-only", fetchImplementation: mockFetch as typeof fetch });
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("拒绝AI在行动中自行添加数字", async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      summary: "需要处理流程问题",
      actions: [
        { candidateId: "flow:intro", action: "检查50%的客户" },
        { candidateId: "employee:reception", action: "复盘未入群样本" },
        { candidateId: "observation:1", action: "继续观察" },
      ],
    }) } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await generateBossAiAnalysis(brief, { apiKey: "test-only", fetchImplementation: mockFetch as typeof fetch });
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
