import { z } from "zod";
import { API_LIMITS } from "../request-limits";
import type { BossAiAnalysis, BossReportSnapshot, BossReportTotals, DailyBossBrief } from "./types";

const analysisSchema = z.object({
  summary: z.string().trim().min(1).max(90),
  actions: z.array(z.object({
    candidateId: z.string().min(1).max(API_LIMITS.identifierCharacters),
    action: z.string().trim().min(1).max(90),
  }).strict()).length(3),
}).strict();

type Fetch = typeof fetch;

function normalizeBusinessCopy(value: string): string {
  return value
    .replaceAll("有效客户", "有效数据")
    .replaceAll("介绍专家", "推专家")
    .replaceAll("下单", "开单")
    .replaceAll("充值", "入金");
}

function assertNoUnverifiedNumbers(value: string) {
  if (/[\d０-９%％$¥￥]/u.test(value))
    throw new Error("AI行动或总结包含未经过程序核对的数字");
}

function usd(cents: number | null): number | null {
  return cents === null ? null : Number((cents / 100).toFixed(2));
}

function aiTotals(totals: BossReportTotals) {
  const { rechargeCents, withdrawalCents, netPerformanceCents, ...counts } = totals;
  return {
    ...counts,
    rechargeUsd: usd(rechargeCents),
    withdrawalUsd: usd(withdrawalCents),
    netPerformanceUsd: usd(netPerformanceCents),
  };
}

function aiSnapshot(snapshot: BossReportSnapshot) {
  return { totals: aiTotals(snapshot.totals), rates: snapshot.rates };
}

function sanitizedPayload(brief: DailyBossBrief) {
  const context = brief.aiContext;
  return {
    reportDate: brief.reportDate,
    totals: aiTotals(brief.totals),
    rates: brief.rates,
    topCompanies: brief.topCompanies.map(({ netPerformanceCents, ...row }) => ({ ...row, netPerformanceUsd: usd(netPerformanceCents) })),
    topGroups: brief.topGroups.map(({ netPerformanceCents, ...row }) => ({ ...row, netPerformanceUsd: usd(netPerformanceCents) })),
    anomalies: brief.anomalies,
    aiContext: context ? {
      headlinePeriod: context.headlinePeriod,
      analysisWindow: context.analysisWindow,
      dataCompleteness: context.dataCompleteness,
      comparison: {
        yesterday: aiSnapshot(context.comparison.yesterday),
        trailing7DayAverage: aiSnapshot(context.comparison.trailing7DayAverage),
      },
      leavesToday: context.leavesToday,
      verifiedProblems: context.verifiedProblems.map(({ id, category, severity, actionHint, facts }) => ({
        id,
        category,
        severity,
        actionHint,
        facts,
      })),
    } : undefined,
  };
}

async function requestDeepSeek(
  brief: DailyBossBrief,
  apiKey: string,
  fetchImplementation: Fetch,
): Promise<BossAiAnalysis> {
  const candidates = brief.aiContext?.verifiedProblems ?? [];
  if (candidates.length !== 3) throw new Error("老板简报必须包含三个已核实候选");
  const response = await fetchImplementation("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      temperature: 0.2,
      // 老板日报只需要短结论，关闭深度思考可避免 token 全耗在内部推理、最终没有正文。
      thinking: { type: "disabled" },
      max_tokens: 800,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是公司经营数据分析助手。程序已经核实并选好了三个问题，你不能新增、删除、改写或重新计算问题。",
            "使用简洁中文，只输出一句不含数字的定性总结，以及针对三个候选问题的三个次日行动。",
            "业务用词必须统一：newFans 叫添加数据，effectiveFans 只能叫有效数据，禁止使用其他叫法。",
            "比例名称必须按口径写清楚：replyRate 叫回复率（回复÷有效数据），joinRate 叫进群率（进群÷有效数据），expertIntroRate 叫推专家率（推专家÷进群），expertContactRate 叫联系率（已联系÷推专家），registrationRate 叫注册率（注册÷推专家），expertOrderRate 叫开单率（开单÷注册）。",
            "统一使用推专家、开单、入金；不要使用介绍专家、下单、充值。",
            "金额口径固定：netPerformanceUsd 是净业绩（入金－出金），与页面排行榜和老板日报完全一致。系统不计算成本，禁止提及成本、返点或计入业绩这类已废弃的旧称。",
            "程序已按真实业务日期、实际负责人、样本门槛和组长标准完成员工评级；不得自行评级或换算比例。",
            "行动只能基于 verifiedProblems 中的 actionHint，原因不确定时必须安排核查，不能把可能原因写成事实。",
            "岗位归责必须严格：接粉员工只直接负责有效数据的回复和进群；进群率统一为进群÷有效数据。接粉名下后续推专家、联系、注册、开单只能叫下游结果，不得直接归责接粉员工。炒群只评价第3天推专家，专家只评价联系、注册和开单。",
            "渠道分析要拆开看有效数据率、回复率和后续产出；回复高但后续差时要写成渠道质量或后续承接待核查，不能混成同一个问题。",
            "headlinePeriod 是单日结果，analysisWindow 是员工和渠道观察窗口，两者禁止混写成同一时间范围。",
            "只有 comparison 提供了对比时才能写上升、下降或改善；评级只允许引用 verifiedProblems 中程序已经核实的结果。",
            "comparison.trailing7DayAverage 中 totals 是近7日每日平均数量，rates 是近7日整体转化率。",
            "样本不足的数据已经被程序拦截，不得评价其好坏。",
            "退群分析必须区分1–8天异常退群、9–13天观察退群、14天起正常退群，并区分已开单与未开单。",
            "所有以 Usd 结尾的金额字段已经是准确美元值，必须原样引用，不得再次换算；只能写美元或使用 $，禁止写元、人民币或 ¥。",
            "summary 和 action 中禁止出现任何数字、百分号或金额；准确数字由本地程序写入问题句。",
            "必须输出 JSON，格式固定为：{\"summary\":\"一句话总结\",\"actions\":[{\"candidateId\":\"候选ID\",\"action\":\"行动\"},{\"candidateId\":\"候选ID\",\"action\":\"行动\"},{\"candidateId\":\"候选ID\",\"action\":\"行动\"}]}。三个候选ID必须各使用一次，行动不超过90个汉字。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `请分析以下已脱敏经营汇总。数据中没有手机号和客户姓名：\n${JSON.stringify(sanitizedPayload(brief))}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek 返回了空内容");
  const parsed = analysisSchema.parse(JSON.parse(content));
  assertNoUnverifiedNumbers(parsed.summary);
  const returnedIds = parsed.actions.map((action) => action.candidateId);
  if (new Set(returnedIds).size !== candidates.length || candidates.some((candidate) => !returnedIds.includes(candidate.id)))
    throw new Error("AI没有逐一处理三个已核实问题");
  for (const row of parsed.actions) assertNoUnverifiedNumbers(row.action);
  return {
    summary: normalizeBusinessCopy(parsed.summary),
    findings: candidates.map((candidate) => candidate.display),
    actions: candidates.map((candidate) => {
      const action = parsed.actions.find((row) => row.candidateId === candidate.id);
      return `${candidate.target}：${normalizeBusinessCopy(action?.action ?? candidate.actionHint)}`;
    }),
  };
}

export async function generateBossAiAnalysis(
  brief: DailyBossBrief,
  options: { apiKey?: string; fetchImplementation?: Fetch } = {},
): Promise<BossAiAnalysis | null> {
  if (!brief.hasData) return null;
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  try {
    return await requestDeepSeek(brief, apiKey, fetchImplementation);
  } catch {
    try {
      return await requestDeepSeek(brief, apiKey, fetchImplementation);
    } catch (error) {
      console.error("DeepSeek boss analysis unavailable", error);
      return null;
    }
  }
}
