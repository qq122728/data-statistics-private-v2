"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import type { ChannelQualityRow } from "../../../lib/analytics/channel-analysis";
import type { BatchTotals } from "../../../lib/metrics";
import { AnalysisState } from "../AnalysisState";
import { formatUsdOr } from "../../../lib/money";

const percent = (value: number | null) => value === null ? "分母为 0" : `${(value * 100).toFixed(1)}%`;
const money = (cents: number | null) => formatUsdOr(cents, "分母为 0");

export function ChannelQualityTable({ rows, filters, resourceMode = false }: { rows: ChannelQualityRow[]; filters: Partial<AnalysisFilters>; resourceMode?: boolean }) {
  type SortKey = "newFans" | "groupRate" | "leaveRate" | "registrationRate" | "orderRate" | "rechargePerOrderCents";
  type ChannelView = "quality" | "conversion";
  const [sort, setSort] = useState<{ key: SortKey; direction: "ascending" | "descending" }>({ key: "rechargePerOrderCents", direction: "descending" });
  const [view, setView] = useState<ChannelView>("quality");
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const sampleOrder = Number(right.rankable) - Number(left.rankable);
    if (sampleOrder) return sampleOrder;
    const leftValue = sort.key === "leaveRate" ? left.rates.leaveRate : left[sort.key];
    const rightValue = sort.key === "leaveRate" ? right.rates.leaveRate : right[sort.key];
    if (leftValue === null) return rightValue === null ? 0 : 1;
    if (rightValue === null) return -1;
    const result = leftValue - rightValue;
    return sort.direction === "ascending" ? result : -result;
  }), [rows, sort]);
  const sortButton = (key: SortKey, label: string) => <th key={key} aria-sort={sort.key === key ? sort.direction : "none"}><button type="button" onClick={() => setSort((current) => ({ key, direction: current.key === key && current.direction === "descending" ? "ascending" : "descending" }))} aria-label={`按${label}排序`} className="analysis-sort-button">{label}</button></th>;
  const channelCell = (row: ChannelQualityRow) => <td className="analysis-sticky-column"><Link className="font-semibold text-[#0b66ff]" href={buildAnalysisHref("/channel-analysis", filters, { normalizedName: row.normalizedName })}>{row.displayName}</Link><span className="ml-2 text-xs text-slate-400">{row.groupCount} 个小组</span></td>;

  if (rows.length === 0) return <AnalysisState title="当前筛选下没有渠道数据" description="请调整日期、小组或人员筛选后重试。" />;
  if (resourceMode) return <section className="panel overflow-hidden">
    <div className="panel-header"><div><h2 className="panel-title">渠道表现</h2><p className="panel-subtitle">按渠道同时看数据质量与成熟后的开单结果；D7 未成熟的渠道不提前判差</p></div></div>
    <div className="data-table-wrap"><table className="data-table resource-channel-table">
      <thead><tr><th>渠道</th><th>添加数据</th><th>有效数据</th><th>有效数据率</th><th>回复率</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>D7添加数据样本</th><th>D7添加数据开单率</th><th>判断</th></tr></thead>
      <tbody>{sortedRows.map((row) => {
        const submitted = row.submitted ?? row.newFans;
        const effective = row.effective ?? row.totals.effectiveFans;
        const effectiveRate = row.effectiveRate ?? (submitted ? effective / submitted : null);
        const customerReplyRate = row.customerReplyRate ?? (effective ? row.totals.replies / effective : null);
        const duplicate = row.duplicate ?? row.totals.duplicateFans;
        const lowAmount = row.lowAmount ?? 0;
        const noWs = row.noWs ?? 0;
        const d7Sample = row.d7Sample ?? 0;
        const d7OrderRate = row.d7OrderRate ?? null;
        const mature = d7Sample >= 20;
        const danger = mature && ((effectiveRate ?? 0) < 0.6 || (d7OrderRate ?? 0) < 0.05);
        const warning = mature && !danger && ((effectiveRate ?? 0) < 0.75 || (d7OrderRate ?? 0) < 0.1);
        return <tr key={row.normalizedName}>
          <td><Link className="font-semibold text-[#0b66ff]" href={buildAnalysisHref("/channel-analysis", filters, { normalizedName: row.normalizedName })}>{row.displayName}</Link><span className="ml-2 text-xs text-slate-400">{row.groupCount} 个小组</span></td>
          <td>{submitted}</td><td>{effective}</td><td>{percent(effectiveRate)}</td><td>{percent(customerReplyRate)}</td><td>{duplicate}</td><td>{lowAmount}</td><td>{noWs}</td>
          <td>{d7Sample}</td><td>{mature ? percent(d7OrderRate) : "未成熟"}</td>
          <td><span className="analysis-status" data-tone={!mature ? "neutral" : danger ? "danger" : warning ? "warning" : "success"}>{!mature ? "样本不足" : danger ? "异常" : warning ? "需关注" : "正常"}</span></td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
  return <section className="panel">
    <div className="panel-header"><div><h2 className="panel-title">渠道质量</h2><p className="panel-subtitle">添加数据少于 20 的渠道不参与好坏排名</p></div></div>
    <div className="channel-analysis-tabs" role="tablist" aria-label="渠道数据视图">
      <button type="button" role="tab" aria-selected={view === "quality"} data-active={view === "quality"} onClick={() => setView("quality")}>渠道数据</button>
      <button type="button" role="tab" aria-selected={view === "conversion"} data-active={view === "conversion"} onClick={() => setView("conversion")}>转化结果</button>
    </div>
    <div className="data-table-wrap analysis-grid" hidden={view !== "quality"}><table className="data-table channel-analysis-table">
      <thead><tr>
        <th scope="col" className="analysis-sticky-column">渠道</th>
        {sortButton("newFans", "添加数据")}
        <th scope="col">撞粉</th><th scope="col">低金额</th><th scope="col">无 WS 号码</th><th scope="col">有效数据</th>
        <th scope="col">回复</th><th scope="col">回复率</th><th scope="col">入群</th>{sortButton("groupRate", "进群率")}
      </tr></thead>
      <tbody>{sortedRows.map((row) => <tr key={row.normalizedName}>
        {channelCell(row)}
        <td>{row.totals.newFans}</td><td>{row.duplicate ?? row.totals.duplicateFans}</td><td>{row.lowAmount ?? 0}</td><td>{row.noWs ?? 0}</td><td>{row.totals.effectiveFans}</td>
        <td>{row.totals.replies}</td><td>{percent(row.rates.replyRate ?? null)}</td><td>{row.totals.groupJoin}</td><td>{percent(row.groupRate)}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="data-table-wrap analysis-grid" hidden={view !== "conversion"}><table className="data-table channel-analysis-table">
      <thead><tr>
        <th scope="col" className="analysis-sticky-column">渠道</th><th scope="col">当前在群</th><th scope="col">退群</th>{sortButton("leaveRate", "异常退群率")}
        <th scope="col">推专家</th><th scope="col">注册</th>{sortButton("registrationRate", "注册率")}{sortButton("orderRate", "开单")}
        <th scope="col">开单率</th><th scope="col">入金总金额</th>{sortButton("rechargePerOrderCents", "每开一单平均入金")}
      </tr></thead>
      <tbody>{sortedRows.map((row) => <tr key={row.normalizedName}>
        {channelCell(row)}
        <td>{row.currentInGroup}</td><td>{row.totals.groupLeave}</td><td>{percent(row.rates.leaveRate)}</td><td>{row.totals.expertIntro}</td>
        <td>{row.totals.registration}</td><td>{percent(row.registrationRate)}</td><td>{row.totals.orders}</td><td>{percent(row.orderRate)}</td>
        <td>{money(row.totals.rechargeCents)}</td><td>{money(row.rechargePerOrderCents)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
