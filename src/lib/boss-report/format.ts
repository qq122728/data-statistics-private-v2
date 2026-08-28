import { formatUsd } from "../money";
import type { BossAiAnalysis, DailyBossBrief } from "./types";

const percent = (value: number | null) => value === null ? "暂无样本" : `${(value * 100).toFixed(1)}%`;

function rankingLines(title: string, rows: DailyBossBrief["topGroups"]): string[] {
  if (!rows.length) return [`${title}：暂无数据`];
  return [title, ...rows.map((row, index) => {
    const owner = row.departmentName ? `${row.departmentName} / ` : "";
    return `${index + 1}. ${owner}${row.name}：净业绩 ${formatUsd(row.netPerformanceCents)}，开单 ${row.orders}`;
  })];
}

export function formatBossDailyBrief(brief: DailyBossBrief, ai: BossAiAnalysis | null): string {
  if (!brief.hasData) {
    return [
      `📊 老板每日简报｜${brief.reportDate}`,
      "",
      "今日暂无业务数据，因此未生成 AI 分析。",
      `待处理：推专家逾期 ${brief.anomalies.overdueExpertIntro}，专家未联系 ${brief.anomalies.overdueExpertContact}，联系后未开单 ${brief.anomalies.overdueOrder}`,
    ].join("\n");
  }

  const lines = [
    `📊 老板每日简报｜${brief.reportDate}`,
    "统计口径：按各组业务日期汇总",
    "",
    "【今日结果｜仅本业务日】",
    `添加数据 ${brief.totals.newFans}｜有效数据 ${brief.totals.effectiveFans}｜回复 ${brief.totals.replies}｜进群 ${brief.totals.groupJoin}`,
    `推专家 ${brief.totals.expertIntro}｜已联系 ${brief.totals.expertContacted}｜注册 ${brief.totals.registration}｜开单 ${brief.totals.orders}`,
    `入金 ${formatUsd(brief.totals.rechargeCents)}｜出金 ${formatUsd(brief.totals.withdrawalCents)}｜净业绩 ${formatUsd(brief.totals.netPerformanceCents)}`,
    "",
    "【转化率】",
    `回复率 ${percent(brief.rates.replyRate)}｜进群率 ${percent(brief.rates.joinRate)}`,
    `进群后推专家率 ${percent(brief.rates.expertIntroRate)}｜推专家后联系率 ${percent(brief.rates.expertContactRate)}｜推专家后开单率 ${percent(brief.rates.expertOrderRate)}`,
    "",
    ...rankingLines("【公司净业绩 TOP 3】", brief.topCompanies),
    "",
    ...rankingLines("【小组净业绩 TOP 3】", brief.topGroups),
    "",
    "【流程异常】",
    `进群第 3 天仍未推专家：${brief.anomalies.overdueExpertIntro}`,
    `推专家后 1 天仍未联系：${brief.anomalies.overdueExpertContact}`,
    `联系后 2 天仍未开单：${brief.anomalies.overdueOrder}`,
    `今日无效粉：${brief.anomalies.invalidCustomers}`,
  ];

  if (ai) {
    const context = brief.aiContext;
    lines.push(
      "",
      "【AI经营分析】",
      ...(context ? [
        `观察窗口：员工与渠道 ${context.analysisWindow.from} 至 ${context.analysisWindow.to}；今日结果仍只统计 ${context.headlinePeriod.date}`,
        `数据确认：${context.dataCompleteness.confirmedFrontline}/${context.dataCompleteness.activeFrontline} 名在职一线员工`,
      ] : []),
      `结论：${ai.summary}`,
      "三个问题：",
      ...ai.findings.map((item, index) => `${index + 1}. ${item}`),
      "三个行动：",
      ...ai.actions.map((item, index) => `${index + 1}. ${item}`),
    );
  } else {
    lines.push("", "【AI经营分析】生成失败，基础统计已正常完成。");
  }
  return lines.join("\n");
}
