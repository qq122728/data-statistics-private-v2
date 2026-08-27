import React from "react";
import Link from "next/link";
import type { ManagementOverview } from "../../../lib/analytics/overview";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import type { ResourceWorkspace } from "../../../lib/analytics/resource-workspace";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import { formatUsdOr } from "../../../lib/money";

const percent = (value: number | null) => value === null ? "样本不足" : `${(value * 100).toFixed(1)}%`;
const money = (value: number | null) => formatUsdOr(value, "待定价");
const statusLabel = { NORMAL: "正常", WARNING: "需关注", DANGER: "异常", INSUFFICIENT: "样本不足" } as const;
const statusTone = { NORMAL: "success", WARNING: "warning", DANGER: "danger", INSUFFICIENT: "neutral" } as const;

function dailyHref(filters: Partial<AnalysisFilters>, mode: "source" | "activity") {
  const href = buildAnalysisHref("/dashboard", filters);
  return `${href}${href.includes("?") ? "&" : "?"}resourceView=${mode}`;
}

function conversionHref(filters: Partial<AnalysisFilters>, groupId?: string, date?: string) {
  return buildAnalysisHref("/resource-conversion", {
    ...filters,
    groupId,
    sourceDateFrom: date ?? filters.sourceDateFrom,
    sourceDateTo: date ?? filters.sourceDateTo,
  });
}

function channelPerformanceHref(filters: Partial<AnalysisFilters>) {
  return buildAnalysisHref("/channel-analysis", filters);
}

export function ResourceCommandCenter({
  overview,
  workspace,
  filters,
  dailyMode,
}: {
  overview: ManagementOverview;
  workspace: ResourceWorkspace;
  filters: Partial<AnalysisFilters>;
  dailyMode: "source" | "activity";
}) {
  const quality = workspace.quality;
  const execution = [
    ["接粉按时回复率", workspace.execution.receptionReply],
    ["回复后按时入群率", workspace.execution.receptionJoin],
    ["进群后按时推专家率", workspace.execution.operatorExpert],
    ["推专家后到期开单率", workspace.execution.expertOrder],
  ] as const;
  const attention = workspace.groups.filter((row) => row.status === "DANGER" || row.status === "WARNING").slice(0, 3);

  return <div className="resource-command-center space-y-3">
    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">资源质量</h2><p className="panel-subtitle">回复率看号码意愿；员工按时回复率放在下方单独计算</p></div></div>
      <div className="resource-kpi-grid">
        <div><span>有效数据率</span><strong>{percent(quality.effectiveRate)}</strong><small>{quality.effective} / {quality.submitted}</small></div>
        <div><span>回复率</span><strong>{percent(quality.customerReplyRate)}</strong><small>{quality.replies} / {quality.effective}</small></div>
        <div><span>撞粉率</span><strong>{percent(quality.duplicateRate)}</strong><small>{quality.duplicate} 个撞粉</small></div>
        <div><span>低金额</span><strong>{quality.lowAmount}</strong><small><Link href={channelPerformanceHref(filters)}>查看渠道表现</Link></small></div>
        <div><span>无 WS 号码</span><strong>{quality.noWs}</strong><small><Link href={channelPerformanceHref(filters)}>查看渠道表现</Link></small></div>
        <div><span>每有效数据成本</span><strong>{money(quality.costPerEffectiveCents)}</strong><small>总成本 {money(quality.costCents)}</small></div>
        <div><span>D7添加数据开单率</span><strong>{percent(quality.matureOrderRate)}</strong><small>开单 {quality.matureOrders} / 成熟 {quality.matureSample}</small></div>
        <div><span>入金</span><strong>{money(overview.summary.financialRechargeCents ?? overview.summary.rechargeCents)}</strong><small>所选来源范围</small></div>
        <div><span>计入业绩</span><strong>{money(overview.summary.profitCents ?? null)}</strong><small>净业绩－资源成本－渠道返点</small></div>
      </div>
    </section>

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">员工执行</h2><p className="panel-subtitle">只统计已经到处理时间的客户，未到时间的不提前扣分</p></div></div>
      <div className="data-table-wrap"><table className="data-table resource-execution-table"><thead><tr><th>岗位指标</th><th>到期数量</th><th>按时完成</th><th>未完成</th><th>完成率</th><th>状态</th></tr></thead><tbody>{execution.map(([label, metric]) => {
        const tone = metric.rate === null ? "neutral" : metric.rate < 0.6 ? "danger" : metric.rate < 0.8 ? "warning" : "success";
        return <tr key={label}><td><strong>{label}</strong></td><td>{metric.eligible}</td><td>{metric.completed}</td><td>{Math.max(0, metric.eligible - metric.completed)}</td><td>{percent(metric.rate)}</td><td><span className="analysis-status" data-tone={tone}>{tone === "danger" ? "异常" : tone === "warning" ? "需关注" : tone === "success" ? "正常" : "样本不足"}</span></td></tr>;
      })}</tbody></table></div>
    </section>

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">小组对比</h2><p className="panel-subtitle">资源质量和员工执行分开显示，避免把号码问题误判成员工问题</p></div></div>
      <div className="data-table-wrap"><table className="data-table resource-group-table"><thead><tr><th>小组</th><th>添加数据</th><th>有效数据率</th><th>回复率</th><th>进群率</th><th>推专家率</th><th>D7添加数据开单率</th><th>计入业绩</th><th>状态</th></tr></thead><tbody>{workspace.groups.map((row) => <tr key={row.groupId}><td><Link className="font-semibold text-blue-700" href={conversionHref(filters, row.groupId)}>{row.groupName}</Link></td><td>{row.submitted}</td><td>{percent(row.effectiveRate)}</td><td>{percent(row.customerReplyRate)}</td><td>{percent(row.receptionJoinRate)}</td><td>{percent(row.operatorExpertRate)}</td><td>{percent(row.matureOrderRate)}</td><td>{money(row.netContributionCents)}</td><td><span className="analysis-status" data-tone={statusTone[row.status]}>{statusLabel[row.status]}</span></td></tr>)}{!workspace.groups.length ? <tr><td colSpan={9} className="empty-state">当前范围没有小组数据</td></tr> : null}</tbody></table></div>
    </section>

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">小组每日数据</h2><p className="panel-subtitle">来源批次看当天来的号码后来怎么样；当日执行看当天实际完成了多少动作</p></div><div className="resource-view-tabs"><Link href={dailyHref(filters, "source")} data-active={dailyMode === "source"}>来源批次</Link><Link href={dailyHref(filters, "activity")} data-active={dailyMode === "activity"}>当日执行</Link></div></div>
      <div className="data-table-wrap"><table className="data-table resource-daily-table"><thead><tr><th>日期</th><th>小组</th>{dailyMode === "source" ? <><th>添加数据</th><th>有效数据</th></> : null}<th>回复</th><th>进群</th><th>推专家</th><th>注册</th><th>开单</th><th>成熟状态</th></tr></thead><tbody>{workspace.daily.map((row) => <tr key={row.key}><td>{row.date}</td><td><Link className="font-semibold text-blue-700" href={conversionHref(filters, row.groupId, dailyMode === "source" ? row.date : undefined)}>{row.groupName}</Link></td>{dailyMode === "source" ? <><td>{row.submitted}</td><td>{row.effective}</td></> : null}<td>{row.replies}</td><td>{row.joined}</td><td>{row.introduced}</td><td>{row.registered}</td><td>{row.orders}</td><td>{dailyMode === "activity" ? "当日完成" : row.mature ? "D7已成熟" : "未成熟"}</td></tr>)}{!workspace.daily.length ? <tr><td colSpan={dailyMode === "source" ? 10 : 8} className="empty-state">当前日期范围没有每日数据</td></tr> : null}</tbody></table></div>
    </section>

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">重点关注</h2><p className="panel-subtitle">最多显示3个需要资源部优先联系组长的问题</p></div></div>
      {attention.length ? <div className="management-attention-list">{attention.map((row) => <div className="management-attention-row" key={row.groupId}><span className="analysis-status" data-tone={statusTone[row.status]}>{statusLabel[row.status]}</span><div><strong>{row.groupName}需要关注</strong><span>有效数据率 {percent(row.effectiveRate)} · 回复率 {percent(row.customerReplyRate)} · D7添加数据开单率 {percent(row.matureOrderRate)}</span></div><Link className="management-attention-action" href={conversionHref(filters, row.groupId)}>查看入群后转化</Link></div>)}</div> : <p className="empty-state">当前没有需要优先处理的小组</p>}
    </section>
  </div>;
}
