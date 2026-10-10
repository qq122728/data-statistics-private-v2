"use client";
import { WORKSPACE_LABELS as labels } from "../../../packages/workspace/navigation";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";
import { IconTrophy, IconUsers } from "./Icons";

import { Podium, RoleRankingTable, ranges, money, type Range, type Payload } from "../../../packages/reporting/LeaderboardRanking";

export function Leaderboard() {
  const [range, setRange] = useState<Range>("month"); const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState("");
  useEffect(() => { setError(""); requestJson<Payload>(`/api/performance-leaderboard?range=${range}`).then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : "榜单加载失败")); }, [range]);
  const groups = data?.groups ?? []; const receptions = data?.receptions ?? []; const operators = data?.operators ?? []; const experts = data?.experts ?? []; const totalOrders = groups.reduce((sum, row) => sum + row.orders, 0); const totalNet = groups.reduce((sum, row) => sum + row.netCents, 0);
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}><div className="card"><div className="card-head"><div><h2 className="card-title">{labels.rankings}</h2><p className="card-note">只在同岗位内部比较，不把接粉、炒群和专家混在一起；不展示客户号码或客户资料。</p></div><span className="badge" data-tone="ok">真实数据</span></div><div style={{ padding: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>{ranges.map(([id, label]) => <button key={id} className="btn" data-size="sm" data-variant={range === id ? "primary" : undefined} onClick={() => setRange(id)}>{label}</button>)}</div>{error ? <p style={{ padding: "0 16px 16px", color: "var(--bad)" }}>{error}</p> : null}<div style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}><div className="card" style={{ padding: 14 }}><IconUsers size={18} /> 参与小组 <strong className="tnum">{groups.length} 个</strong></div><div className="card" style={{ padding: 14 }}><IconTrophy size={18} /> 范围合计 <strong className="tnum">{totalOrders} 单 · {money(totalNet)}</strong></div></div><p className="card-note" style={{ padding: "0 16px 16px" }}>{data ? `${data.range.from} 至 ${data.range.to} · ${data.timezone}` : "正在读取真实榜单…"}</p></div><RoleRankingTable title="接粉岗位完整排名" note="按本人归属客户确认进群数比较" rows={receptions} metric="joined" /><RoleRankingTable title="炒群岗位完整排名" note="新版按客户当前群负责人，统计期间内进群数" rows={operators} metric="joined" /><RoleRankingTable title="专家岗位完整排名" note="新版按客户当前专家负责人，统计期间内开单数" rows={experts} metric="orders" /><Podium trophy={<IconTrophy size={15} />} title="小组单量榜 TOP3" note="按开单数排名" rows={groups} metric="orders" /><Podium trophy={<IconTrophy size={15} />} title="小组业绩榜 TOP3" note="按入金减出金后的净业绩排名" rows={groups} metric="netCents" /></div>;
}
