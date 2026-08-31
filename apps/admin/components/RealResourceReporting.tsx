"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import { RealEntityMetricsTable, type RealMetricColumn } from "./RealMetricsTable";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth";
type Row = {
  channel: { id: string; name: string };
  group: { id: string; name: string; departmentName: string };
  period: { from: string; to: string; today: string; timezone: string };
  totals: {
    added: number; collision: number; lowAmount: number; noWs: number; effective: number;
    replied: number; joined: number; left: number; abnormalLeft: number; inGroup: number;
    pushed: number; registered: number; ordered: number; depositCents: number; withdrawalCents: number;
  };
};
type Payload = { rows: Row[]; days: Array<{ date: string; rows: Row[] }>; groups: Array<{ id: string; name: string; departmentName: string }> };
const RANGES: Array<{ id: Range; label: string }> = [{ id: "today", label: "今日" }, { id: "yesterday", label: "昨日" }, { id: "7d", label: "近7天" }, { id: "30d", label: "近30天" }, { id: "month", label: "本月" }, { id: "lastMonth", label: "上月" }];

export function RealResourceReporting({ detail }: { detail: boolean }) {
  const [range, setRange] = useState<Range>("month");
  const [data, setData] = useState<Payload | null>(null);
  const [groupId, setGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const payload = await requestJson<Payload>(`/api/resource/reporting?range=${range}`);
      setData(payload);
      setGroupId((current) => {
        const currentHasData = payload.rows.some((row) => row.group.id === current && Object.values(row.totals).some((value) => value !== 0));
        if (currentHasData) return current;
        return payload.rows.find((row) => Object.values(row.totals).some((value) => value !== 0))?.group.id
          ?? payload.groups.find((group) => group.id === current)?.id
          ?? payload.groups[0]?.id
          ?? "";
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "资源部渠道数据加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [range]);
  const rows = useMemo(() => detail ? (data?.rows.filter((row) => row.group.id === groupId) ?? []) : (data?.rows ?? []), [data, detail, groupId]);
  function toMetricRow(row: Row): RealMetricColumn & { sub?: string } { return {
    id: `${row.group.id}-${row.channel.id}`,
    name: row.group.name,
    sub: `${row.group.departmentName} · ${row.channel.name}`,
    metrics: {
      added: row.totals.added,
      collision: row.totals.collision,
      lowAmount: row.totals.lowAmount,
      noWs: row.totals.noWs,
      effective: row.totals.effective,
      replied: row.totals.replied,
      joined: row.totals.joined,
      leftNormal: Math.max(0, row.totals.left - row.totals.abnormalLeft),
      leftAbnormal: row.totals.abnormalLeft,
      inGroup: row.totals.inGroup,
      pushed: row.totals.pushed,
      registered: row.totals.registered,
      ordered: row.totals.ordered,
      depositCents: row.totals.depositCents,
      withdrawalCents: row.totals.withdrawalCents,
      netCents: row.totals.depositCents - row.totals.withdrawalCents,
    },
    rates: {
      replyRate: row.totals.effective ? row.totals.replied / row.totals.effective : null,
      groupRate: row.totals.replied ? row.totals.joined / row.totals.replied : null,
      leaveRate: row.totals.joined ? row.totals.abnormalLeft / row.totals.joined : null,
    },
  }; }
  const metricRows = useMemo<Array<RealMetricColumn & { sub?: string }>>(() => rows.map(toMetricRow), [rows]);
  const dailyTables = useMemo(() => (data?.days ?? []).map((day) => ({
    date: day.date,
    rows: day.rows.filter((row) => row.group.id === groupId).map(toMetricRow),
  })).filter((day) => day.rows.length > 0), [data, groupId]);

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {RANGES.map((item) => <button key={item.id} className="btn" data-size="sm" data-variant={range === item.id ? "primary" : undefined} onClick={() => setRange(item.id)}>{item.label}</button>)}
      {detail ? <><span style={{ marginLeft: 8, color: "var(--ink-3)" }}>小组</span><select className="field" value={groupId} onChange={(event) => setGroupId(event.target.value)}>{data?.groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.departmentName}</option>)}</select></> : null}
      <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 仅授权渠道</span>
    </div>
    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}<button className="btn" data-size="sm" style={{ marginLeft: 10 }} onClick={() => void load()}>重试</button></div> : null}
    {loading && !data ? <section className="card" style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>正在读取真实渠道数据…</section> : null}
    {!loading || data ? <RealEntityMetricsTable
      title={detail ? "小组区间汇总" : "授权渠道汇总"}
      note={detail ? "选择一个小组，先看所选区间汇总，再向下查看每日明细。" : "每行一个小组与渠道；资源部只看账号已授权的渠道，不显示客户号码和客户进度。"}
      entityLabel={detail ? "小组 / 渠道" : "小组"}
      rows={metricRows}
      badge={<button className="btn" data-size="sm" onClick={() => void load()}>刷新</button>}
    /> : null}
    {detail && (!loading || data) ? <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h2 className="card-title">每日明细</h2><p className="card-note">所选小组、授权渠道的逐日数据，最新日期排在最上面。</p></div>
        <span className="badge" data-tone="mute">共 {dailyTables.length} 天</span>
      </div>
      {dailyTables.map((day) => <RealEntityMetricsTable key={day.date} title={day.date} entityLabel="小组 / 渠道" rows={day.rows} />)}
      {!dailyTables.length ? <section className="card" style={{ padding: 44, textAlign: "center", color: "var(--ink-3)" }}>所选区间内没有每日明细</section> : null}
    </div> : null}
  </div>;
}
