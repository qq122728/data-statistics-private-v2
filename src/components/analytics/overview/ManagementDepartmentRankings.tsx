import React from "react";
import type { ManagementOverview } from "../../../lib/analytics/overview";
import { buildHeadquartersPerformance } from "../../../lib/analytics/headquarters-performance";
import { formatUsdOr } from "../../../lib/money";

const money = (cents: number | null) => formatUsdOr(cents, "待定价");

type DepartmentRow = ReturnType<typeof buildHeadquartersPerformance>["companies"][number];

function RankingTable({ title, rows }: { title: string; rows: DepartmentRow[] }) {
  return <section className="panel overflow-hidden" aria-label={title}>
    <div className="panel-header"><div><h2 className="panel-title">{title}</h2><p className="panel-subtitle">完整列出全部门；仅总公司管理员和公司管理员可查看。</p></div></div>
    <div className="data-table-wrap"><table className="data-table leaderboard-table"><thead><tr><th>排名</th><th>部门</th><th>小组数</th><th>开单</th><th>入金</th><th>出金</th><th>计入业绩</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.departmentId}><td><span className="leaderboard-list-rank" data-top={index < 3}>{index + 1}</span></td><td><strong>{row.departmentName}</strong></td><td>{row.groupCount}</td><td className="font-semibold">{row.orders}</td><td>{money(row.rechargeCents)}</td><td>{money(row.withdrawalCents)}</td><td className={row.profitCents !== null && row.profitCents < 0 ? "font-semibold text-red-700" : "font-semibold"}>{money(row.profitCents)}</td></tr>)}
      {!rows.length ? <tr><td colSpan={7} className="empty-state">当前日期范围没有部门数据。</td></tr> : null}
    </tbody></table></div>
  </section>;
}

/** 高层完整榜单，和全员可见的精英榜刻意分开。 */
export function ManagementDepartmentRankings({ performanceRows }: { performanceRows: NonNullable<ManagementOverview["groupComparison"]> }) {
  const departments = buildHeadquartersPerformance(performanceRows).companies;
  const orders = [...departments].sort((left, right) => right.orders - left.orders || (right.profitCents ?? Number.NEGATIVE_INFINITY) - (left.profitCents ?? Number.NEGATIVE_INFINITY) || left.departmentName.localeCompare(right.departmentName, "zh-CN"));
  const performance = [...departments].sort((left, right) => (right.profitCents ?? Number.NEGATIVE_INFINITY) - (left.profitCents ?? Number.NEGATIVE_INFINITY) || right.orders - left.orders || left.departmentName.localeCompare(right.departmentName, "zh-CN"));
  return <div className="space-y-4"><RankingTable title="全部门开单排名完整榜单" rows={orders} /><RankingTable title="全部门业绩排名完整榜单" rows={performance} /></div>;
}
