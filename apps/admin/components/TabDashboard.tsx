"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";
import { IconAlert, IconStar, IconUsers } from "./Icons";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth";
type Stats = { name: string; customers: number; orders: number; netCents: number };
type Payload = { timezone: string; range: { from: string; to: string }; person: Stats; group: Stats; share: number | null; alsoExpert: boolean };
const ranges: Array<[Range, string]> = [["today", "今日"], ["yesterday", "昨日"], ["7d", "近7天"], ["30d", "近30天"], ["month", "本月"], ["lastMonth", "上月"]];
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function TabDashboard() {
  const [range, setRange] = useState<Range>("month"); const [data, setData] = useState<Payload | null>(null); const [error, setError] = useState("");
  useEffect(() => { setError(""); requestJson<Payload>(`/api/lead/dashboard?range=${range}`).then(setData).catch((caught) => setError(caught instanceof Error ? caught.message : "看板加载失败")); }, [range]);
  const share = data?.share == null ? "—" : `${(data.share * 100).toFixed(1)}%`;
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}><section className="card" style={{ padding: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>{ranges.map(([id, label]) => <button key={id} className="btn" data-size="sm" data-variant={range === id ? "primary" : undefined} onClick={() => setRange(id)}>{label}</button>)}<span className="badge" data-tone="ok" style={{ marginLeft: "auto" }}>真实数据</span></section>{error ? <section className="card" style={{ padding: 16, color: "var(--bad)" }}>{error}</section> : null}<section className="card" style={{ background: "var(--warn-soft)", borderColor: "var(--warn-line)" }}><div style={{ padding: 16, display: "flex", gap: 10 }}><IconAlert size={18} /><div><strong>个人岗位成绩和小组管理成绩分开，不相加</strong><p style={{ margin: "4px 0 0", color: "var(--ink-2)" }}>{data?.alsoExpert ? `当前组长同时兼任专家；本人经手客户占全组专家客户的 ${share}，供上级透明核对。` : "当前组长没有兼任专家，因此个人专家成绩显示为 0；小组管理成绩照常统计。"}</p></div></div></section><div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}><StatsCard title="我作为专家的成绩" note="只算明确归属本人专家岗位的客户" icon="star" stats={data?.person} /><StatsCard title="我管理的小组成绩" note="全组汇总，属于管理成绩" icon="users" stats={data?.group} /></div><p className="muted">{data ? `${data.range.from} 至 ${data.range.to} · ${data.timezone}` : "正在读取真实看板…"}</p></div>;
}

function StatsCard({ title, note, icon, stats }: { title: string; note: string; icon: "star" | "users"; stats?: Stats }) {
  return <section className="card"><div className="card-head"><div><h2 className="card-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>{icon === "star" ? <IconStar size={16} /> : <IconUsers size={16} />}{title}</h2><p className="card-note">{note}</p></div></div><div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}><Stat label="经手客户" value={`${stats?.customers ?? 0} 位`} /><Stat label="已开单" value={`${stats?.orders ?? 0} 单`} /><Stat label="净业绩" value={money(stats?.netCents ?? 0)} /></div></section>;
}
function Stat({ label, value }: { label: string; value: string }) { return <div><div className="muted">{label}</div><strong className="tnum" style={{ display: "block", marginTop: 4, fontSize: 19 }}>{value}</strong></div>; }
