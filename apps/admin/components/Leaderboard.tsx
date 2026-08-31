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

export function Leaderboard() {
  const [range, setRange] = useState<Range>("month"); const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState("");
  useEffect(() => { setError(""); requestJson<Payload>(`/api/performance-leaderboard?range=${range}`).then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : "榜单加载失败")); }, [range]);
  const groups = data?.groups ?? []; const receptions = data?.receptions ?? []; const operators = data?.operators ?? []; const experts = data?.experts ?? []; const people = receptions; const totalOrders = groups.reduce((sum, row) => sum + row.orders, 0); const totalNet = groups.reduce((sum, row) => sum + row.netCents, 0);
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}><div className="card"><div className="card-head"><div><h2 className="card-title">精英榜</h2><p className="card-note">当前账号只能看到权限范围内的公开排名，不展示客户号码或客户资料；所有区间都按整段总数重新计算。</p></div><span className="badge" data-tone="ok">真实数据</span></div><div style={{ padding: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>{ranges.map(([id, label]) => <button key={id} className="btn" data-size="sm" data-variant={range === id ? "primary" : undefined} onClick={() => setRange(id)}>{label}</button>)}</div>{error ? <p style={{ padding: "0 16px 16px", color: "var(--bad)" }}>{error}</p> : null}<div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}><div className="card" style={{ padding: 14 }}><IconUsers size={18} /> 参与小组 <strong className="tnum">{groups.length} 个</strong></div><div className="card" style={{ padding: 14 }}><IconTrophy size={18} /> 范围合计 <strong className="tnum">{totalOrders} 单 · {money(totalNet)}</strong></div></div><p className="card-note" style={{ padding: "0 16px 16px" }}>{data ? `${data.range.from} 至 ${data.range.to} · ${data.timezone}` : "正在读取真实榜单…"}</p></div><Podium title="小组单量榜 TOP3" note="按开单数排名" rows={groups} metric="orders" /><Podium title="小组业绩榜 TOP3" note="按入金减出金后的净业绩排名" rows={groups} metric="netCents" /><Podium title="个人接粉拉群榜 TOP3" note="按接粉名下客户确认进群数排名" rows={people} metric="joined" /><Podium title="个人开单榜 TOP3" note="按接粉名下最终开单客户数排名" rows={people} metric="orders" /><Podium title="个人业绩榜 TOP3" note="按接粉名下客户净业绩排名" rows={people} metric="netCents" /></div>;
}
