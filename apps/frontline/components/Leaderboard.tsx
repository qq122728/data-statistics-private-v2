"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";
import { IconTrophy, IconUsers } from "./Icons";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth";
type Row = { id: string; name: string; groupName?: string; departmentName?: string; joined: number; orders: number; netCents: number };
type Payload = { timezone: string; range: { from: string; to: string }; groups: Row[]; receptions: Row[]; operators: Row[]; experts: Row[] };
type Metric = "joined" | "orders" | "netCents";
const ranges: Array<[Range, string]> = [["today", "今日"], ["yesterday", "昨日"], ["7d", "近7天"], ["30d", "近30天"], ["month", "本月"], ["lastMonth", "上月"]];
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const value = (row: Row, metric: Metric) => metric === "netCents" ? money(row.netCents) : `${row[metric]} ${metric === "orders" ? "单" : "位"}`;

function Podium({ title, note, rows, metric }: { title: string; note: string; rows: Row[]; metric: Metric }) {
  const top = [...rows].sort((a, b) => b[metric] - a[metric]).slice(0, 3);
  return <section className="card"><div className="card-head"><div><h2 className="card-title">{title}</h2><p className="card-note">{note}</p></div></div><div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", alignItems: "end", gap: 14 }}>{[1, 0, 2].map((index) => { const row = top[index]; const rank = index + 1; return <div key={rank} style={{ minHeight: rank === 1 ? 176 : 152, padding: 18, border: "1px solid var(--line)", borderRadius: "var(--radius-lg)", background: rank === 1 ? "#fdf7e8" : "var(--surface-sunken)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center" }}><span style={{ color: rank === 1 ? "#996612" : "var(--ink-3)", fontWeight: 700 }}><IconTrophy size={15} /> 第{rank}名</span>{row ? <><strong>{row.name}</strong><small className="muted">{row.groupName ?? row.departmentName ?? "小组"}</small><strong className="tnum" style={{ fontSize: rank === 1 ? 22 : 18 }}>{value(row, metric)}</strong></> : <span className="muted">暂无数据</span>}</div>; })}</div></section>;
}

function RoleRankingTable({ title, note, rows, metric }: { title: string; note: string; rows: Row[]; metric: Metric }) {
  const sorted = [...rows].sort((left, right) => right[metric] - left[metric] || left.name.localeCompare(right.name, "zh-CN"));
  const average = rows.length ? rows.reduce((sum, row) => sum + row[metric], 0) / rows.length : 0;
  return <section className="card"><div className="card-head"><div><h2 className="card-title">{title}</h2><p className="card-note">{note}；低于同岗位平均值一半时显示红色预警。</p></div><span className="badge" data-tone="mute">同岗位平均 {metric === "netCents" ? money(Math.round(average)) : average.toFixed(1)}</span></div><div className="table-scroll" style={{ maxHeight: 430 }}><table className="grid-table"><thead><tr><th>排名</th><th>员工</th><th>所属小组</th><th>本期成绩</th><th>同岗位平均</th><th>达到平均</th><th>状态</th></tr></thead><tbody>{sorted.map((row, index) => {
    const ratio = average > 0 ? row[metric] / average : null;
    const insufficient = rows.length < 3 || average <= 0;
    const tone = insufficient ? "mute" : ratio !== null && ratio < .5 ? "bad" : ratio !== null && ratio < .8 ? "warn" : "ok";
    const status = insufficient ? "样本不足" : ratio !== null && ratio < .5 ? "低于平均50%" : ratio !== null && ratio < .8 ? "需要关注" : "正常";
    return <tr key={`${row.id}-${index}`}><td><strong className="tnum">{index + 1}</strong></td><td><strong>{row.name}</strong></td><td>{row.groupName ?? row.departmentName ?? "—"}</td><td className="tnum"><strong>{value(row, metric)}</strong></td><td className="tnum">{metric === "netCents" ? money(Math.round(average)) : average.toFixed(1)}</td><td className="tnum">{ratio === null ? "—" : `${(ratio * 100).toFixed(0)}%`}</td><td><span className="badge" data-tone={tone}>{status}</span></td></tr>;
  })}{!sorted.length ? <tr><td colSpan={7} style={{ textAlign: "center" }} className="muted">当前范围没有该岗位数据</td></tr> : null}</tbody></table></div></section>;
}

export function Leaderboard({ managedScope = false }: { managedScope?: boolean }) {
  const [range, setRange] = useState<Range>("month"); const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState("");
  useEffect(() => { setError(""); requestJson<Payload>(`/api/performance-leaderboard?range=${range}${managedScope ? "&scope=managed" : ""}`).then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : "榜单加载失败")); }, [managedScope, range]);
  const groups = data?.groups ?? []; const receptions = data?.receptions ?? []; const operators = data?.operators ?? []; const experts = data?.experts ?? []; const totalOrders = groups.reduce((sum, row) => sum + row.orders, 0); const totalNet = groups.reduce((sum, row) => sum + row.netCents, 0);
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}><div className="card"><div className="card-head"><div><h2 className="card-title">全公司员工排名与预警</h2><p className="card-note">接粉、炒群、专家分别比较，不把不同岗位混在一起；不展示客户号码。</p></div><span className="badge" data-tone="ok">真实数据</span></div><div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>{ranges.map(([id, label]) => <button key={id} className="btn" data-size="sm" data-variant={range === id ? "primary" : undefined} onClick={() => setRange(id)}>{label}</button>)}</div>{error ? <p style={{ padding: "0 16px 16px", color: "var(--bad)" }}>{error}</p> : null}<div style={{ padding: "0 12px 12px", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}><div className="card" style={{ padding: 12 }}><IconUsers size={18} /> 参与小组 <strong className="tnum">{groups.length} 个</strong></div><div className="card" style={{ padding: 12 }}><IconTrophy size={18} /> 合计 <strong className="tnum">{totalOrders} 单 · {money(totalNet)}</strong></div></div><p className="card-note" style={{ padding: "0 12px 12px" }}>{data ? `${data.range.from} 至 ${data.range.to} · ${data.timezone}` : "正在读取真实榜单…"}</p></div><RoleRankingTable title="接粉岗位完整排名" note="按本人接粉数据产生的确认进群数比较" rows={receptions} metric="joined" /><RoleRankingTable title="炒群岗位完整排名" note="按本人炒群承接数据比较" rows={operators} metric="joined" /><RoleRankingTable title="专家岗位完整排名" note="按本人负责客户的开单数比较" rows={experts} metric="orders" /><Podium title="小组单量榜 TOP3" note="按专家开单数排名" rows={groups} metric="orders" /><Podium title="小组业绩榜 TOP3" note="按入金减出金后的净业绩排名" rows={groups} metric="netCents" /></div>;
}
