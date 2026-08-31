"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";
import { timezoneLabel } from "@/lib/timezone-label";
import { RealEntityMetricsTable, type RealMetricColumn, type RealMetrics } from "./RealMetricsTable";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";
type Group = {
  id: string;
  name: string;
  timezone: string;
  department: { id: string; name: string };
  company: { id: string; name: string } | null;
  period: { today: string; from: string; to: string };
  totals: RealMetrics;
  rates: RealMetricColumn["rates"];
};
type Payload = { range: { label: string }; groups: Group[] };
type Level = "group" | "department" | "company";

const ranges: Array<[Range, string]> = [["today", "今日"], ["yesterday", "昨日"], ["7d", "近7天"], ["30d", "近30天"], ["month", "本月"], ["lastMonth", "上月"]];
const emptyMetrics = (): RealMetrics => ({ added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, effective: 0, replied: 0, joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, initialDepositCents: 0, rechargeCents: 0, depositCents: 0, withdrawalCents: 0, netCents: 0 });
const addMetrics = (target: RealMetrics, value: RealMetrics) => { for (const key of Object.keys(target) as Array<keyof RealMetrics>) target[key] += value[key] ?? 0; };
const divide = (a: number, b: number) => b > 0 ? a / b : null;

export function RealHierarchyOverview({ level, title, fixedMonth = false }: { level: Level; title: string; fixedMonth?: boolean }) {
  const initialToday = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);
  const initialMonthStart = `${initialToday.slice(0, 7)}-01`;
  const [range, setRange] = useState<Range>(level === "group" ? "custom" : "month");
  const [from, setFrom] = useState(initialMonthStart);
  const [to, setTo] = useState(initialToday);
  const [dateLimit, setDateLimit] = useState(initialToday);
  const initializedFromBackend = useRef(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const params = new URLSearchParams({ range });
    if (range === "custom") { params.set("sourceDateFrom", from); params.set("sourceDateTo", to); }
    void requestJson<Payload>(`/api/org/reporting?${params}`)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        if (level === "group" && !initializedFromBackend.current) {
          const businessToday = value.groups[0]?.period.today;
          if (businessToday) {
            initializedFromBackend.current = true;
            setDateLimit(businessToday);
            setFrom(`${businessToday.slice(0, 7)}-01`);
            setTo(businessToday);
          }
        }
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "汇总加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, from, to, reloadKey]);

  const rows = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; sub: string; metrics: RealMetrics }>();
    for (const group of data?.groups ?? []) {
      const company = group.company ?? { id: "__unassigned_company__", name: "未归属公司" };
      const id = level === "group" ? group.id : level === "department" ? group.department.id : company.id;
      const name = level === "group" ? group.name : level === "department" ? group.department.name : company.name;
      const sub = level === "group" ? `${group.department.name} · ${timezoneLabel(group.timezone)}` : level === "department" ? company.name : "";
      const row = grouped.get(id) ?? { id, name, sub, metrics: emptyMetrics() };
      addMetrics(row.metrics, group.totals);
      grouped.set(id, row);
    }
    return [...grouped.values()].map((row) => ({
      ...row,
      rates: {
        replyRate: divide(row.metrics.replied, row.metrics.effective),
        groupRate: divide(row.metrics.joined, row.metrics.replied),
        leaveRate: divide(row.metrics.leftAbnormal, row.metrics.joined),
        abnormalLeaveRate: divide(row.metrics.leftAbnormal, Math.max(0, row.metrics.joined - row.metrics.leftNormal)),
      },
    }));
  }, [data, level]);

  const entityLabel = level === "group" ? "小组" : level === "department" ? "部门" : "公司";
  const note = `${data?.range.label ?? "当前区间"} · ${entityLabel}作为行、完整业务指标作为列。`;

  return <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    {!fixedMonth && level === "group" ? <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>统计区间</span>
      <input className="field" type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setRange("custom"); }} />
      <span style={{ color: "var(--ink-3)" }}>至</span>
      <input className="field" type="date" value={to} min={from} max={dateLimit} onChange={(event) => { setTo(event.target.value); setRange("custom"); }} />
      <button className="btn" data-size="sm" onClick={() => { setFrom(`${dateLimit.slice(0, 7)}-01`); setTo(dateLimit); setRange("custom"); }}>本月</button>
      <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · {entityLabel}口径</span>
    </div> : !fixedMonth ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>统计区间</span>
      {ranges.map(([id, label]) => <button key={id} className="btn" data-size="sm" data-variant={range === id ? "primary" : undefined} onClick={() => setRange(id)}>{label}</button>)}
      <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · {entityLabel}口径</span>
    </div> : <div style={{ display: "flex", justifyContent: "flex-end" }}><span className="badge" data-tone="mute">只读 · {entityLabel}口径 · 固定月度</span></div>}
    {loading ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>正在读取真实数据…</section> : null}
    {error ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--bad)" }}><p style={{ margin: 0 }}>{error}</p><button type="button" className="btn" data-size="sm" style={{ marginTop: 14 }} onClick={() => setReloadKey((value) => value + 1)}>重新加载</button></section> : null}
    {!loading && !error ? <RealEntityMetricsTable title={title} note={note} entityLabel={entityLabel} rows={rows} /> : null}
  </div>;
}
