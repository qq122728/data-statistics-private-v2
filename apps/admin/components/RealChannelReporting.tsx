"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import { RealEntityMetricsTable, RealMetricMatrix, type RealMetricColumn, type RealMetrics } from "./RealMetricsTable";

type RangePreset = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth";
type Totals = {
  added: number; collision: number; lowAmount: number; noWs: number; effective: number;
  replied: number; joined: number; left: number; leftAbnormal: number; inGroup: number;
  pushed: number; registered: number; ordered: number; depositCents: number; withdrawalCents: number; netCents: number;
};
type Rates = { replyRate?: number | null; groupRate?: number | null; leaveRate?: number | null };
type MemberRow = { id: string; name: string; totals: Totals; rates: Rates };
type ChannelRow = { normalizedName: string; name: string; totals: Totals; rates: Rates; members: MemberRow[] };
type ChannelDay = { date: string; rows: ChannelRow[] };
type Response = { group: { id: string; name: string; timezone: string }; range: { label: string; from: string; to: string }; rows: ChannelRow[]; days: ChannelDay[] };

const OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: "today", label: "今日" }, { value: "yesterday", label: "昨日" }, { value: "7d", label: "近7天" },
  { value: "30d", label: "近30天" }, { value: "month", label: "本月" }, { value: "lastMonth", label: "上月" },
];

function metrics(totals: Totals): RealMetrics {
  return {
    added: totals.added, collision: totals.collision, lowAmount: totals.lowAmount, noWs: totals.noWs,
    effective: totals.effective, replied: totals.replied, joined: totals.joined,
    leftNormal: Math.max(0, totals.left - totals.leftAbnormal), leftAbnormal: totals.leftAbnormal,
    inGroup: totals.inGroup, pushed: totals.pushed, registered: totals.registered, ordered: totals.ordered,
    depositCents: totals.depositCents, withdrawalCents: totals.withdrawalCents, netCents: totals.netCents,
  };
}

export function RealChannelReporting({ groupId = "" }: { groupId?: string; embedded?: boolean }) {
  const [range, setRange] = useState<RangePreset>("month");
  const [view, setView] = useState<"detail" | "compare">("detail");
  const [channel, setChannel] = useState("");
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const params = new URLSearchParams({ range });
    if (groupId) params.set("groupId", groupId);
    const endpoint = groupId ? "/api/org/channel-reporting" : "/api/lead/channel-reporting";
    void requestJson<Response>(`${endpoint}?${params}`)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setChannel((current) => result.rows.some((row) => row.normalizedName === current) ? current : result.rows[0]?.normalizedName ?? "");
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "渠道统计加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, groupId]);

  const selected = data?.rows.find((row) => row.normalizedName === channel) ?? null;
  const matrixColumns = useMemo<RealMetricColumn[]>(() => selected ? [
    { id: "total", name: "总计", total: true, metrics: metrics(selected.totals), rates: selected.rates },
    ...selected.members.map((member) => ({ id: member.id, name: member.name, metrics: metrics(member.totals), rates: member.rates })),
  ] : [], [selected]);
  const comparisonRows = useMemo(() => (data?.rows ?? []).map((row) => ({ id: row.normalizedName, name: row.name, metrics: metrics(row.totals), rates: row.rates })), [data]);
  const dailyMatrices = useMemo(() => (data?.days ?? []).map((day) => {
    const row = day.rows.find((item) => item.normalizedName === channel);
    if (!row) return null;
    return {
      date: day.date,
      columns: [
        { id: `total-${day.date}`, name: "总计", total: true, metrics: metrics(row.totals), rates: row.rates },
        ...row.members.map((member) => ({ id: `${member.id}-${day.date}`, name: member.name, metrics: metrics(member.totals), rates: member.rates })),
      ] satisfies RealMetricColumn[],
    };
  }).filter((item): item is { date: string; columns: RealMetricColumn[] } => Boolean(item)), [data, channel]);

  return <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn" data-variant={view === "detail" ? "primary" : undefined} onClick={() => setView("detail")}>核对明细</button>
      <button className="btn" data-variant={view === "compare" ? "primary" : undefined} onClick={() => setView("compare")}>渠道对比</button>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {view === "detail" ? <><span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>来源渠道选择</span><select className="field" value={channel} onChange={(event) => setChannel(event.target.value)}>{data?.rows.map((row) => <option key={row.normalizedName} value={row.normalizedName}>{row.name}</option>)}</select></> : null}
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginLeft: view === "detail" ? 10 : 0 }}>统计区间</span>
      {OPTIONS.map((option) => <button key={option.value} className="btn" data-size="sm" data-variant={range === option.value ? "primary" : undefined} onClick={() => setRange(option.value)}>{option.label}</button>)}
      <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>核对口径 · 与数据汇总同源</span>
    </div>
    {loading ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>正在读取真实渠道数据…</section> : null}
    {error ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--bad)" }}>{error}</section> : null}
    {!loading && !error && view === "detail" && selected ? <RealMetricMatrix
      title={`${selected.name} · 区间汇总`}
      note={`${data?.range.from} 至 ${data?.range.to} 累计 · 只读，用来和资源部核对；不发送审核。`}
      columns={matrixColumns}
    /> : null}
    {!loading && !error && view === "detail" && selected ? <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h2 className="card-title">每日明细</h2><p className="card-note">当前渠道在所选区间内的逐日数据，最新日期排在最上面。</p></div>
        <span className="badge" data-tone="mute">共 {dailyMatrices.length} 天</span>
      </div>
      {dailyMatrices.map((day) => <RealMetricMatrix key={day.date} title={`${selected.name} · ${day.date}`} columns={day.columns} />)}
      {!dailyMatrices.length ? <section className="card" style={{ padding: 44, textAlign: "center", color: "var(--ink-3)" }}>所选区间内没有渠道每日明细</section> : null}
    </div> : null}
    {!loading && !error && view === "compare" ? <RealEntityMetricsTable title="渠道对比" note={`${data?.range.label ?? "当前区间"} · 每行一个来源渠道。`} entityLabel="渠道" rows={comparisonRows} /> : null}
    {!loading && !error && !data?.rows.length ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>当前日期范围没有渠道数据</section> : null}
  </div>;
}
