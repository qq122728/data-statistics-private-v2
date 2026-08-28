"use client";

import { useState } from "react";
import type { ManagementOverview } from "../../../lib/analytics/overview";
import { calculateConversionRates, type BatchTotals } from "../../../lib/metrics";
import { Drawer } from "../../ui/Drawer";
import { AnalysisState } from "../AnalysisState";
import { FunnelSummary } from "../FunnelSummary";
import { formatUsd as money } from "../../../lib/money";

const rate = (value: number | null) => value === null ? "暂无数据" : `${(value * 100).toFixed(1)}%`;
const stageNames = { NEW_FANS: "添加数据", REPLIES: "回复", GROUP_JOIN: "进群", EXPERT_INTRO: "推专家", REGISTRATION: "注册", ORDER: "开单" } as const;

export function OverviewFunnelDrawer({
  open,
  onClose,
  totals,
  largestDrop,
}: {
  open: boolean;
  onClose: () => void;
  totals: BatchTotals;
  largestDrop: ManagementOverview["largestDrop"];
}) {
  return <Drawer title="全局转化漏斗" open={open} onClose={onClose} className="max-w-lg">
    <div className="p-5"><FunnelSummary totals={totals} rates={calculateConversionRates(totals)} largestDrop={largestDrop} /></div>
  </Drawer>;
}

export function OverviewSummary({ overview, compact = false }: { overview: ManagementOverview; compact?: boolean }) {
  const [funnelOpen, setFunnelOpen] = useState(false);
  if (!overview.hasData) {
    return compact ? <section className="panel lead-dashboard-section"><p className="lead-dashboard-empty">当前范围没有实际录入记录，这不代表业务结果是 0。</p></section> : <AnalysisState title="没有可汇总的数据" description="当前范围内没有实际录入记录，这不代表业务结果是 0。" />;
  }
  const cards = [
    ["添加数据", overview.summary.newFans.toLocaleString("zh-CN")],
    ["开单", overview.summary.orders.toLocaleString("zh-CN")],
    ["入金", money(overview.summary.rechargeCents)],
    ["D7添加数据开单率", rate(overview.summary.matureOrderRate ?? overview.summary.orderRate)],
  ];
  const financialCards = [
    ["出金", money(overview.summary.withdrawalCents ?? 0)],
    ["净业绩", money(overview.summary.netPerformanceCents ?? 0)],
  ];
  if (compact) return <>
    <section className="panel lead-dashboard-section overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">团队经营概览</h2><p className="panel-subtitle">结果、人员和最大掉点集中在一张表</p></div></div>
      <div className="data-table-wrap"><table className="data-table lead-overview-table"><tbody>
        <tr><th>经营结果</th>{cards.map(([label, value]) => <td key={label}><span className="lead-table-label">{label}</span><strong className="lead-table-value">{value}</strong></td>)}</tr>
        <tr><th>资金结算</th>{financialCards.map(([label, value]) => <td key={label}><span className="lead-table-label">{label}</span><strong className="lead-table-value">{value}</strong></td>)}</tr>
        {overview.workforce ? <tr><th>在岗人员</th>{[["合计", overview.workforce.total], ["接粉", overview.workforce.byRole.reception], ["炒群", overview.workforce.byRole.groupOperator], ["专家", overview.workforce.byRole.expert]].map(([label, value]) => <td key={String(label)}><span className="lead-table-label">{label}</span><strong className="lead-table-value">{value}</strong></td>)}</tr> : null}
        <tr><th>最大掉点</th><td colSpan={3}>{overview.largestDrop ? <><strong>{stageNames[overview.largestDrop.from]} → {stageNames[overview.largestDrop.to]}</strong><span className="ml-2 text-sm text-red-700">流失 {overview.largestDrop.lost} 人</span></> : <span className="text-slate-500">暂无可计算数据</span>}</td><td><button type="button" className="text-sm font-semibold text-[#0b66ff]" onClick={() => setFunnelOpen(true)}>查看漏斗</button></td></tr>
      </tbody></table></div>
    </section>
    <section className="panel lead-dashboard-section overflow-hidden"><div className="panel-header"><div><h2 className="panel-title">近 7 日实际结果</h2><p className="panel-subtitle">按动作发生日期统计开单和入金</p></div></div><div className="data-table-wrap"><table className="data-table lead-trend-table"><thead><tr><th>日期</th>{overview.trend.map((point) => <th key={point.occurredOn}>{point.occurredOn.slice(5)}</th>)}</tr></thead><tbody><tr><th>开单</th>{overview.trend.map((point) => <td key={point.occurredOn}>{point.orders}</td>)}</tr><tr><th>入金</th>{overview.trend.map((point) => <td key={point.occurredOn}>{money(point.rechargeCents)}</td>)}</tr></tbody></table></div></section>
    <OverviewFunnelDrawer open={funnelOpen} onClose={() => setFunnelOpen(false)} totals={overview.totals} largestDrop={overview.largestDrop} />
  </>;
  return <>
    {overview.workforce && <section className="panel overflow-hidden"><div className="grid divide-y divide-slate-100 sm:grid-cols-5 sm:divide-x sm:divide-y-0">{[
      ["在岗合计", overview.workforce.total],
      ["前台接粉", overview.workforce.byRole.reception],
      ["前台炒群", overview.workforce.byRole.groupOperator],
      ["前台专家", overview.workforce.byRole.expert],
      ["组长", overview.workforce.byRole.lead],
    ].map(([label, value]) => <div key={String(label)} className="px-4 py-3"><p className="m-0 text-xs text-slate-500">{label}</p><p className="mb-0 mt-1 text-xl font-bold text-slate-900">{value}</p></div>)}</div></section>}
    <section className="metric-grid management-metric-grid">{[...cards, ...financialCards].map(([label, value]) => <article className="metric-card" key={label}><p className="metric-label">{label}</p><p className="metric-value">{value}</p></article>)}</section>
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,.6fr)]">
      <article className="panel"><div className="panel-header"><div><h2 className="panel-title">近 7 日趋势</h2><p className="panel-subtitle">按实际发生日期统计开单和入金</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>日期</th><th>开单</th><th>入金</th></tr></thead><tbody>{overview.trend.map((point) => <tr key={point.occurredOn}><td>{point.occurredOn}</td><td>{point.orders}</td><td>{money(point.rechargeCents)}</td></tr>)}</tbody></table></div></article>
      <article className="panel"><div className="panel-header"><div><h2 className="panel-title">最大掉点</h2><p className="panel-subtitle">最近 7 日漏斗中流失最多的一段</p></div></div><div className="p-5">{overview.largestDrop ? <><p className="text-lg font-semibold text-slate-800">{stageNames[overview.largestDrop.from]} → {stageNames[overview.largestDrop.to]}</p><p className="mt-2 text-sm text-slate-500">流失 {overview.largestDrop.lost} 人</p><button type="button" className="mt-4 text-sm font-semibold text-[#0b66ff]" onClick={() => setFunnelOpen(true)}>查看完整漏斗</button></> : <p className="text-sm text-slate-500">暂无可计算数据</p>}</div></article>
    </section>
    <OverviewFunnelDrawer open={funnelOpen} onClose={() => setFunnelOpen(false)} totals={overview.totals} largestDrop={overview.largestDrop} />
  </>;
}
