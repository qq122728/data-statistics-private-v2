"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import { ResourceReportTable, type ResourceReportEntity } from "../../../packages/reporting/ResourceReportTable";
import { ResourceFieldControls, useResourceFields } from "../../../packages/reporting/ResourceFieldControls";
import { hasHistoricalResourceValues, isPreviousResourceMonth, type ResourceBusiness, type ResourceTotals } from "../../../packages/reporting/resource-fields";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth";
type Group = { id: string; name: string; departmentName: string; groupType: ResourceBusiness };
type Row = {
  channel: { id: string; name: string };
  group: Group;
  period: { from: string; to: string; today: string; timezone: string };
  totals: ResourceTotals;
};
type Payload = { rows: Row[]; days?: Array<{ date: string; rows: Row[] }>; groups: Group[] };
const RANGES: Array<{ id: Range; label: string }> = [{ id: "today", label: "今日" }, { id: "yesterday", label: "昨日" }, { id: "7d", label: "近7天" }, { id: "30d", label: "近30天" }, { id: "month", label: "本月" }, { id: "lastMonth", label: "上月" }];
const toEntity = (row: Row): ResourceReportEntity => ({ id: `${row.group.id}-${row.channel.id}`, name: row.group.name, sub: `${row.group.departmentName} · ${row.channel.name}`, totals: row.totals });

export function RealResourceReporting({ detail, userId }: { detail: boolean; userId: string }) {
  const [range, setRange] = useState<Range>("month");
  const [business, setBusiness] = useState<ResourceBusiness>("HACKER");
  const [data, setData] = useState<Payload | null>(null);
  const [groupId, setGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const payload = await requestJson<Payload>(`/api/resource/reporting?range=${range}`);
      setData(payload);
      setGroupId(current => {
        if (payload.rows.some(row => row.group.id === current && Object.values(row.totals).some(value => value !== 0))) return current;
        return payload.rows.find(row => Object.values(row.totals).some(value => value !== 0))?.group.id
          ?? payload.groups.find(group => group.id === current)?.id ?? payload.groups[0]?.id ?? "";
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "资源部渠道数据加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [range]);
  const groups = (data?.groups ?? []).filter(group => group.groupType === business);
  const selectedGroupId = groups.some(group => group.id === groupId) ? groupId : groups[0]?.id ?? "";
  const rows = useMemo(() => (data?.rows ?? []).filter(row => row.group.groupType === business && (!detail || row.group.id === selectedGroupId)), [data, detail, selectedGroupId, business]);
  const dailyTables = useMemo(() => (data?.days ?? []).map(day => ({ date: day.date, rows: day.rows.filter(row => row.group.groupType === business && row.group.id === selectedGroupId) })).filter(day => day.rows.length > 0), [data, selectedGroupId, business]);
  const fieldState = useResourceFields({
    userId, business, reportType: detail ? "admin:group-detail" : "admin:summary",
    historyContext: JSON.stringify([rows.map(row => [row.period.from, row.period.to]), detail ? selectedGroupId : ""]),
    historicalValues: hasHistoricalResourceValues([...rows, ...(detail ? dailyTables.flatMap(day => day.rows) : [])].map(row => row.totals)),
    previousMonth: isPreviousResourceMonth(rows.map(row => row.period)),
  });

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div role="group" aria-label="资源业务类型">{([ ["HACKER", "黑客组数据"], ["LAWYER", "律师组数据"] ] as const).map(([id, label]) => <button key={id} className="btn" aria-pressed={business === id} data-variant={business === id ? "primary" : undefined} onClick={() => { setBusiness(id); setGroupId(""); }}>{label}</button>)}</div>
      {RANGES.map(item => <button key={item.id} className="btn" data-size="sm" data-variant={range === item.id ? "primary" : undefined} onClick={() => setRange(item.id)}>{item.label}</button>)}
      {detail ? <label>小组 <select className="field" value={selectedGroupId} onChange={event => setGroupId(event.target.value)}>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.departmentName}</option>)}</select></label> : null}
      <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 仅授权渠道</span>
      <button className="btn" data-size="sm" disabled={loading} onClick={() => void load()}>刷新</button>
    </div>
    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}<button className="btn" data-size="sm" style={{ marginLeft: 10 }} onClick={() => void load()}>重试</button></div> : null}
    {loading ? <section className="card" style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>正在读取真实渠道数据…</section> : <>
      <ResourceFieldControls state={fieldState} />
      <ResourceReportTable title={detail ? "小组区间汇总" : "授权渠道汇总"} fields={fieldState.fields} layout="columns" moneyDecimals={2}
        note="每列一个小组与授权渠道；后续数据归原接粉成员。数量与资金按发生日期汇总，当前在群为截止日存量。" entities={rows.map(toEntity)} />
      {detail ? <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div><h2 className="card-title">每日明细</h2><p className="card-note">所选小组、授权渠道的逐日数据，最新日期在上；栏目显示与上方区间汇总一致。共 {dailyTables.length} 天。</p></div>
        {dailyTables.map(day => <ResourceReportTable key={day.date} title={day.date} fields={fieldState.fields} layout="columns" moneyDecimals={2} entities={day.rows.map(toEntity)} />)}
        {!dailyTables.length ? <section className="card" style={{ padding: 44, textAlign: "center", color: "var(--ink-3)" }}>所选区间内没有每日明细</section> : null}
      </section> : null}
    </>}
  </div>;
}
