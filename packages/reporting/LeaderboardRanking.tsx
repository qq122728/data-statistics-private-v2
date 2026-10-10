import React, { type ReactNode } from "react";

export type Row = { id: string; name: string; groupName?: string; departmentName?: string; joined: number; orders: number; netCents: number };
export type Payload = { timezone: string; range: { from: string; to: string }; groups: Row[]; receptions: Row[]; operators: Row[]; experts: Row[] };
export type Metric = "joined" | "orders" | "netCents";
export type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth";
export const ranges: Array<[Range, string]> = [["today", "今日"], ["yesterday", "昨日"], ["7d", "近7天"], ["30d", "近30天"], ["month", "本月"], ["lastMonth", "上月"]];
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const value = (row: Row, metric: Metric) => metric === "netCents" ? money(row.netCents) : `${row[metric]} ${metric === "orders" ? "单" : "位"}`;
// Use the same deterministic order in both workspaces and both ranking displays.
export function sortRankingRows(rows: Row[], metric: Metric): Row[] {
  return [...rows].sort((left, right) => right[metric] - left[metric] || left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id));
}
export function Podium({ title, note, rows, metric, trophy }: { title: string; note: string; rows: Row[]; metric: Metric; trophy?: ReactNode }) {
  if(!rows.some(row=>row[metric]!==0))return <section className="card"><div className="card-head"><h2 className="card-title">{title}</h2></div><p style={{padding:16}}>暂无可比较数据，暂不排名。</p></section>;
  const top = sortRankingRows(rows, metric).slice(0, 3);
  return <section className="card"><div className="card-head"><div><h2 className="card-title">{title}</h2><p className="card-note">{note}</p></div></div><div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", alignItems: "end", gap: 14 }}>{[1, 0, 2].map((index) => { const row = top[index]; const rank = index + 1; return <div key={rank} style={{ minHeight: rank === 1 ? 176 : 152, padding: 18, border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", background: rank === 1 ? "#fdf7e8" : "var(--surface-sunken)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center" }}><span style={{ color: rank === 1 ? "#996612" : "var(--ink-3)", fontWeight: 700 }}>{trophy} 第{rank}名</span>{row ? <><strong>{row.name}</strong><small className="muted">{row.groupName ?? row.departmentName ?? "小组"}</small><strong className="tnum" style={{ fontSize: rank === 1 ? 22 : 18 }}>{value(row, metric)}</strong></> : <span className="muted">暂无数据</span>}</div>; })}</div></section>;
}

export function RoleRankingTable({ title, note, rows, metric }: { title: string; note: string; rows: Row[]; metric: Metric }) {
  const sorted = sortRankingRows(rows, metric);
  const average = rows.length ? rows.reduce((sum, row) => sum + row[metric], 0) / rows.length : 0;
  return <section className="card"><div className="card-head"><div><h2 className="card-title">{title}</h2><p className="card-note">{note}；低于同岗位平均值一半时显示红色预警。</p></div><span className="badge" data-tone="mute">同岗位平均 {metric === "netCents" ? money(Math.round(average)) : average.toFixed(1)}</span></div><div className="table-scroll" style={{ maxHeight: 430 }}><table className="grid-table"><thead><tr><th>排名</th><th>员工</th><th>所属小组</th><th>本期成绩</th><th>同岗位平均</th><th>达到平均</th><th>状态</th></tr></thead><tbody>{sorted.map((row, index) => {
    const ratio = average > 0 ? row[metric] / average : null;
    const insufficient = rows.length < 3 || average <= 0;
    const tone = insufficient ? "mute" : ratio !== null && ratio < .5 ? "bad" : ratio !== null && ratio < .8 ? "warn" : "ok";
    const status = insufficient ? "样本不足" : ratio !== null && ratio < .5 ? "低于平均50%" : ratio !== null && ratio < .8 ? "需要关注" : "正常";
    return <tr key={`${row.id}-${index}`}><td><strong className="tnum">{index + 1}</strong></td><td><strong>{row.name}</strong></td><td>{row.groupName ?? row.departmentName ?? "—"}</td><td className="tnum"><strong>{value(row, metric)}</strong></td><td className="tnum">{metric === "netCents" ? money(Math.round(average)) : average.toFixed(1)}</td><td className="tnum">{ratio === null ? "—" : `${(ratio * 100).toFixed(0)}%`}</td><td><span className="badge" data-tone={tone}>{status}</span></td></tr>;
  })}{!sorted.length ? <tr><td colSpan={7} style={{ textAlign: "center" }} className="muted">当前范围没有该岗位数据</td></tr> : null}</tbody></table></div></section>;
}
