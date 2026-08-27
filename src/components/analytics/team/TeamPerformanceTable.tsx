"use client";

import Link from "next/link";
import { useMemo } from "react";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import type { GroupPerformanceRow, MemberPerformanceRow, TeamDailyRow } from "../../../lib/analytics/team-performance";
import { addBatchTotals, emptyBatchTotals, type BatchTotals } from "../../../lib/metrics";
import { formatUsd as money } from "../../../lib/money";

type TeamRates = { replyRate: number | null; joinRate: number | null; leaveRate: number | null; registrationRate: number | null; orderRate: number | null };

const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const divide = (numerator: number, denominator: number) => denominator === 0 ? null : numerator / denominator;

export function teamRates(totals: BatchTotals): TeamRates {
  return {
    replyRate: divide(totals.replies, totals.effectiveFans),
    joinRate: divide(totals.groupJoin, totals.replies),
    leaveRate: divide(totals.abnormalGroupLeave ?? 0, totals.groupJoin),
    registrationRate: divide(totals.registration, totals.expertIntro),
    orderRate: divide(totals.orders, totals.registration),
  };
}

function dailyTotal(rows: TeamDailyRow[]) {
  const totals = emptyBatchTotals();
  let lowAmount = 0;
  let noWs = 0;
  for (const row of rows) {
    addBatchTotals(totals, row.totals);
    lowAmount += row.lowAmount;
    noWs += row.noWs;
  }
  return { totals, lowAmount, noWs };
}

function SummaryTable({ rows }: { rows: TeamDailyRow[] }) {
  const summary = useMemo(() => dailyTotal(rows), [rows]);
  const rates = teamRates(summary.totals);
  const net = summary.totals.rechargeCents - summary.totals.withdrawalCents;
  return <section id="team-performance-summary" className="panel scroll-mt-5">
    <div className="panel-header"><div><h2 className="panel-title">成员表现汇总</h2><p className="panel-subtitle">汇总放在成员表现最上方；数量按实际发生日期统计，比例帮助判断客户卡在哪一步。</p></div></div>
    <div className="data-table-wrap"><table className="data-table team-summary-table">
      <thead><tr><th>添加数据</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>有效数据</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>退群</th><th>异常退群率</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead>
      <tbody><tr><td>{summary.totals.newFans}</td><td>{summary.totals.duplicateFans}</td><td>{summary.lowAmount}</td><td>{summary.noWs}</td><td>{summary.totals.effectiveFans}</td><td>{summary.totals.replies}</td><td>{percent(rates.replyRate)}</td><td>{summary.totals.groupJoin}</td><td>{percent(rates.joinRate)}</td><td>{summary.totals.groupLeave}</td><td>{percent(rates.leaveRate)}</td><td>{summary.totals.expertIntro}</td><td>{summary.totals.registration}</td><td>{percent(rates.registrationRate)}</td><td>{summary.totals.orders}</td><td>{percent(rates.orderRate)}</td><td>{money(summary.totals.rechargeCents)}</td><td>{money(summary.totals.withdrawalCents)}</td><td className="font-semibold">{money(net)}</td></tr></tbody>
    </table></div>
  </section>;
}

type PeriodGroupRow = {
  groupId: string;
  groupName: string;
  activePeople: number;
  totals: BatchTotals;
  lowAmount: number;
  noWs: number;
};

/**
 * The company total, group total, and daily matrix deliberately all derive from
 * dailyRows. This keeps the three layers on the same "actual occurrence date"
 * basis instead of mixing source-date totals with daily activity totals.
 */
function periodGroupRows(groupRows: GroupPerformanceRow[], dailyRows: TeamDailyRow[]): PeriodGroupRow[] {
  const rows = new Map<string, PeriodGroupRow>();
  for (const group of groupRows) rows.set(group.groupId, {
    groupId: group.groupId,
    groupName: group.groupName,
    activePeople: group.activePeople,
    totals: emptyBatchTotals(),
    lowAmount: 0,
    noWs: 0,
  });
  for (const daily of dailyRows) {
    const current = rows.get(daily.groupId) ?? {
      groupId: daily.groupId,
      groupName: daily.groupName,
      activePeople: 0,
      totals: emptyBatchTotals(),
      lowAmount: 0,
      noWs: 0,
    };
    addBatchTotals(current.totals, daily.totals);
    current.lowAmount += daily.lowAmount;
    current.noWs += daily.noWs;
    rows.set(daily.groupId, current);
  }
  return [...rows.values()].sort((left, right) => left.groupName.localeCompare(right.groupName, "zh-CN"));
}

function groupDailyHref(groupId: string, filters: Partial<AnalysisFilters>, pathname: string) {
  const params = new URLSearchParams();
  for (const key of ["departmentId", "countryCode", "normalizedName", "sourceDateFrom", "sourceDateTo"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  params.append("groupIds", groupId);
  return `${pathname}?${params.toString()}`;
}

function PeriodGroupSummaryTable({ groupRows, dailyRows, filters, groupDailyPath }: { groupRows: GroupPerformanceRow[]; dailyRows: TeamDailyRow[]; filters: Partial<AnalysisFilters>; groupDailyPath?: string }) {
  const rows = useMemo(() => periodGroupRows(groupRows, dailyRows), [groupRows, dailyRows]);
  const plural = rows.length !== 1;
  return <section className="panel">
    <div className="panel-header"><div><h2 className="panel-title">本期{plural ? "各小组" : "小组"}数据汇总</h2><p className="panel-subtitle">默认同时展示全部小组；需要查看某一个小组时，再使用上方“小组”筛选。</p></div><span className="text-xs text-slate-500">{plural ? `${rows.length} 个小组` : "已筛选单个小组"}</span></div>
    <div className="data-table-wrap"><table className="data-table team-group-period-table">
      <thead><tr><th>小组</th><th>在岗人数</th><th>添加数据</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>有效数据</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>退群</th><th>异常退群率</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead>
      <tbody>{rows.map((row) => {
        const rates = teamRates(row.totals);
        return <tr key={row.groupId}><td className="font-semibold">{groupDailyPath ? <Link className="text-[#0b66ff]" href={groupDailyHref(row.groupId, filters, groupDailyPath)}>{row.groupName}</Link> : row.groupName}</td><td>{row.activePeople}</td><td>{row.totals.newFans}</td><td>{row.totals.duplicateFans}</td><td>{row.lowAmount}</td><td>{row.noWs}</td><td>{row.totals.effectiveFans}</td><td>{row.totals.replies}</td><td>{percent(rates.replyRate)}</td><td>{row.totals.groupJoin}</td><td>{percent(rates.joinRate)}</td><td>{row.totals.groupLeave}</td><td>{percent(rates.leaveRate)}</td><td>{row.totals.expertIntro}</td><td>{row.totals.registration}</td><td>{percent(rates.registrationRate)}</td><td>{row.totals.orders}</td><td>{percent(rates.orderRate)}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.withdrawalCents)}</td><td className="font-semibold">{money(row.totals.rechargeCents - row.totals.withdrawalCents)}</td></tr>;
      })}{!rows.length ? <tr><td colSpan={21} className="empty-state">当前日期范围还没有小组数据</td></tr> : null}</tbody>
    </table></div>
  </section>;
}

export function GroupDailyDetailsTable({ rows }: { rows: TeamDailyRow[] }) {
  return <section id="team-performance-daily" className="panel scroll-mt-5">
    <div className="panel-header"><div><h2 className="panel-title">每日明细</h2><p className="panel-subtitle">同一天不同小组分别显示，方便查看每天的数量、转化和业绩。</p></div><span className="text-xs text-slate-500">共 {rows.length} 条</span></div>
    <div className="data-table-wrap"><table className="data-table team-daily-table">
      <thead><tr><th>日期</th><th>小组</th><th>添加数据</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>有效数据</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>退群</th><th>异常退群率</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead>
      <tbody>{rows.map((row) => {
        const rates = teamRates(row.totals);
        return <tr key={row.key}><td>{row.occurredOn}</td><td className="font-semibold">{row.groupName}</td><td>{row.totals.newFans}</td><td>{row.totals.duplicateFans}</td><td>{row.lowAmount}</td><td>{row.noWs}</td><td>{row.totals.effectiveFans}</td><td>{row.totals.replies}</td><td>{percent(rates.replyRate)}</td><td>{row.totals.groupJoin}</td><td>{percent(rates.joinRate)}</td><td>{row.totals.groupLeave}</td><td>{percent(rates.leaveRate)}</td><td>{row.totals.expertIntro}</td><td>{row.totals.registration}</td><td>{percent(rates.registrationRate)}</td><td>{row.totals.orders}</td><td>{percent(rates.orderRate)}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.withdrawalCents)}</td><td className="font-semibold">{money(row.totals.rechargeCents - row.totals.withdrawalCents)}</td></tr>;
      })}{!rows.length ? <tr><td colSpan={21} className="empty-state">当前日期范围还没有团队数据</td></tr> : null}</tbody>
    </table></div>
  </section>;
}

function MemberTable({ groupRows, memberRows, mode, filters }: { groupRows: GroupPerformanceRow[]; memberRows: MemberPerformanceRow[]; mode: "groups" | "members"; filters: Partial<AnalysisFilters> }) {
  if (mode === "groups") return <section className="panel">
    <div className="panel-header"><div><h2 className="panel-title">小组对比</h2><p className="panel-subtitle">按所选来源日期比较；点击小组可查看本组成员。</p></div></div>
    <div className="data-table-wrap"><table className="data-table team-member-table"><thead><tr><th>公司 / 小组</th><th>在岗人数</th><th>添加数据</th><th>撞粉</th><th>有效数据</th><th>回复</th><th>进群</th><th>退群</th><th>推专家</th><th>注册</th><th>开单</th><th>入金</th><th>净业绩</th><th>回复率</th><th>进群率</th><th>异常退群率</th><th>注册率</th><th>开单率</th></tr></thead><tbody>{groupRows.map((row) => {
      const rates = teamRates(row.totals);
      return <tr key={row.groupId}><td><span className="block text-xs text-slate-400">{row.departmentName ?? "未分公司"}</span><Link className="font-semibold text-[#0b66ff]" href={buildAnalysisHref("/team-performance", filters, { departmentId: row.departmentId, groupId: row.groupId, memberId: undefined })}>{row.groupName}</Link></td><td>{row.activePeople}</td><td>{row.totals.newFans}</td><td>{row.totals.duplicateFans}</td><td>{row.totals.effectiveFans}</td><td>{row.totals.replies}</td><td>{row.totals.groupJoin}</td><td>{row.totals.groupLeave}</td><td>{row.totals.expertIntro}</td><td>{row.totals.registration}</td><td>{row.totals.orders}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.rechargeCents - row.totals.withdrawalCents)}</td><td>{percent(rates.replyRate)}</td><td>{percent(rates.joinRate)}</td><td>{percent(rates.leaveRate)}</td><td>{percent(rates.registrationRate)}</td><td>{percent(rates.orderRate)}</td></tr>;
    })}{!groupRows.length ? <tr><td colSpan={18} className="empty-state">当前筛选下没有小组数据</td></tr> : null}</tbody></table></div>
  </section>;

  return <section className="panel">
    <div className="panel-header"><div><h2 className="panel-title">成员表现</h2><p className="panel-subtitle">成员对比单独查看，不与小组日报混在一起。</p></div></div>
    <div className="data-table-wrap"><table className="data-table team-member-table"><thead><tr><th>成员</th><th>添加数据</th><th>撞粉</th><th>有效数据</th><th>回复</th><th>进群</th><th>退群</th><th>推专家</th><th>注册</th><th>开单</th><th>入金</th><th>净业绩</th><th>回复率</th><th>进群率</th><th>异常退群率</th><th>注册率</th><th>开单率</th></tr></thead><tbody>{memberRows.map((row) => {
      const rates = teamRates(row.totals);
      return <tr key={`${row.groupId}:${row.userId}`}><td><Link className="font-semibold text-[#0b66ff]" href={buildAnalysisHref("/team-performance", filters, { groupId: row.groupId, memberId: row.userId })}>{row.name}</Link>{!row.active ? <span className="ml-2 text-xs text-slate-400">已停用</span> : null}</td><td>{row.totals.newFans}</td><td>{row.totals.duplicateFans}</td><td>{row.totals.effectiveFans}</td><td>{row.totals.replies}</td><td>{row.totals.groupJoin}</td><td>{row.totals.groupLeave}</td><td>{row.totals.expertIntro}</td><td>{row.totals.registration}</td><td>{row.totals.orders}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.rechargeCents - row.totals.withdrawalCents)}</td><td>{percent(rates.replyRate)}</td><td>{percent(rates.joinRate)}</td><td>{percent(rates.leaveRate)}</td><td>{percent(rates.registrationRate)}</td><td>{percent(rates.orderRate)}</td></tr>;
    })}{!memberRows.length ? <tr><td colSpan={17} className="empty-state">当前筛选下没有成员数据</td></tr> : null}</tbody></table></div>
  </section>;
}

export type TeamPerformanceView = "summary" | "daily";

export function TeamPerformanceTable({ groupRows, memberRows, dailyRows = [], mode, filters, view = "summary", showPeriodGroupSummary = false, showNavigation = true, showComparison = true, groupDailyPath }: { groupRows: GroupPerformanceRow[]; memberRows: MemberPerformanceRow[]; dailyRows?: TeamDailyRow[]; mode: "groups" | "members"; filters: Partial<AnalysisFilters>; view?: TeamPerformanceView; showPeriodGroupSummary?: boolean; showNavigation?: boolean; showComparison?: boolean; groupDailyPath?: string }) {
  const viewHref = (nextView: TeamPerformanceView) => {
    const base = buildAnalysisHref("/team-performance", filters);
    return `${base}${base.includes("?") ? "&" : "?"}view=${nextView}`;
  };
  return <section className="space-y-3">
    {showNavigation ? <nav className="team-performance-jumps" aria-label="团队表现页面入口">
      <Link href={viewHref("summary")} data-tone="summary" aria-current={view === "summary" ? "page" : undefined}>数据汇总</Link>
      <Link href={viewHref("daily")} data-tone="daily" aria-current={view === "daily" ? "page" : undefined}>每日明细</Link>
      <Link href={buildAnalysisHref("/role-rankings", filters)} data-tone="ranking">完整榜单</Link>
    </nav> : null}
    {view === "summary" ? <>
      <SummaryTable rows={dailyRows} />
      {showComparison ? <MemberTable groupRows={groupRows} memberRows={memberRows} mode={mode} filters={filters} /> : null}
      {showPeriodGroupSummary ? <PeriodGroupSummaryTable groupRows={groupRows} dailyRows={dailyRows} filters={filters} groupDailyPath={groupDailyPath} /> : null}
    </> : <GroupDailyDetailsTable rows={dailyRows} />}
  </section>;
}
