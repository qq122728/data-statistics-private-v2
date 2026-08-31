"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";
import { timezoneLabel } from "@/lib/timezone-label";
import { RealEntityMetricsTable, RealMetricMatrix, type RealMetricColumn, type RealMetrics } from "./RealMetricsTable";

type Range = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "custom";
type Rates = { replyRate?: number | null; groupRate?: number | null; leaveRate?: number | null };
type Group = {
  id: string; name: string; timezone: string; period: { today: string; from: string; to: string };
  department: { id: string; name: string }; company: { id: string; name: string } | null;
  totals: RealMetrics; rates: Rates;
};
type Member = {
  id: string; name: string; groupId: string; groupName: string; active: boolean;
  totals: RealMetrics;
  rates: Rates;
};
type Day = { date: string; groups: Array<{ groupId: string; totals: RealMetrics; rates: Rates }>; members: Array<{ id: string; name: string; groupId: string; totals: RealMetrics; rates: Rates }> };
type Payload = { range: { label: string }; groups: Group[]; members: Member[]; days: Day[] };

const OPTIONS: Array<[Range, string]> = [["today", "今日"], ["yesterday", "昨日"], ["7d", "近7天"], ["30d", "近30天"], ["month", "本月"], ["lastMonth", "上月"]];
function memberMetrics(member: Member): RealMetrics {
  return member.totals;
}

export function RealOrganizationReporting({ permissionLabel, actorGroupMode = false, fixedGroupId = "" }: { permissionLabel: string; actorGroupMode?: boolean; fixedGroupId?: string }) {
  const initialToday = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);
  const initialMonthStart = `${initialToday.slice(0, 7)}-01`;
  const usesDateInputs = actorGroupMode || Boolean(fixedGroupId);
  const [range, setRange] = useState<Range>(usesDateInputs ? "custom" : "month");
  const [from, setFrom] = useState(initialMonthStart);
  const [to, setTo] = useState(initialToday);
  const [dateLimit, setDateLimit] = useState(initialToday);
  const initializedFromBackend = useRef(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");

  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    const params = new URLSearchParams({ range });
    if (range === "custom") { params.set("sourceDateFrom", from); params.set("sourceDateTo", to); }
    if (fixedGroupId) params.set("groupId", fixedGroupId);
    void requestJson<Payload>(`/api/org/reporting?${params}`)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        if (usesDateInputs && !initializedFromBackend.current) {
          const businessToday = value.groups.find((group) => group.id === fixedGroupId)?.period.today
            ?? value.groups[0]?.period.today;
          if (businessToday) {
            initializedFromBackend.current = true;
            setDateLimit(businessToday);
            setFrom(`${businessToday.slice(0, 7)}-01`);
            setTo(businessToday);
          }
        }
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "真实统计加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, fixedGroupId, from, to]);

  const companies = useMemo(() => [...new Map((data?.groups ?? []).flatMap((group) => group.company ? [[group.company.id, group.company.name] as const] : [])).entries()].map(([id, name]) => ({ id, name })), [data]);
  const departments = useMemo(() => [...new Map((data?.groups ?? []).filter((group) => !companyId || group.company?.id === companyId).map((group) => [group.department.id, group.department.name] as const)).entries()].map(([id, name]) => ({ id, name })), [data, companyId]);
  const groups = useMemo(() => (data?.groups ?? []).filter((group) => (!companyId || group.company?.id === companyId) && (!departmentId || group.department.id === departmentId)), [data, companyId, departmentId]);
  const effectiveGroupId = fixedGroupId || (actorGroupMode ? data?.groups[0]?.id ?? "" : groupId);
  const selectedGroup = data?.groups.find((group) => group.id === effectiveGroupId) ?? null;
  const members = (data?.members ?? []).filter((member) => member.groupId === effectiveGroupId);
  const columns = useMemo<RealMetricColumn[]>(() => selectedGroup ? [
    { id: "total", name: "总计", total: true, metrics: selectedGroup.totals, rates: selectedGroup.rates },
    ...members.map((member) => ({ id: member.id, name: member.name, metrics: memberMetrics(member), rates: member.rates })),
  ] : [], [selectedGroup, members]);
  const dayMatrices = useMemo(() => effectiveGroupId ? (data?.days ?? []).map((day) => {
    const group = day.groups.find((item) => item.groupId === effectiveGroupId);
    if (!group) return null;
    const dayMembers = day.members.filter((member) => member.groupId === effectiveGroupId);
    return {
      date: day.date,
      columns: [
        { id: `total-${day.date}`, name: "总计", total: true, metrics: group.totals, rates: group.rates },
        ...members.map((member) => {
          const daily = dayMembers.find((item) => item.id === member.id);
          return { id: `${member.id}-${day.date}`, name: member.name, metrics: daily?.totals ?? { added: 0, collision: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, depositCents: 0, withdrawalCents: 0, netCents: 0 }, rates: daily?.rates ?? {} };
        }),
      ] satisfies RealMetricColumn[],
    };
  }).filter((item): item is { date: string; columns: RealMetricColumn[] } => Boolean(item)) : [], [data, effectiveGroupId, members]);
  const groupRows = groups.map((group) => ({ id: group.id, name: group.name, sub: `${group.department.name} · ${timezoneLabel(group.timezone)}`, metrics: group.totals, rates: group.rates }));
  const isHq = permissionLabel.includes("总公司");
  const isCompany = permissionLabel.includes("公司");

  return <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    {!actorGroupMode && !fixedGroupId ? <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {isHq ? <><span className="label">选择公司</span><select className="field" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setDepartmentId(""); setGroupId(""); }}><option value="">全部公司</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></> : null}
      {isCompany ? <><span className="label">选择部门</span><select className="field" value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setGroupId(""); }}><option value="">全部部门</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></> : null}
      <span className="label">选择小组</span><select className="field" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">全部小组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
      <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>{permissionLabel}</span>
    </div> : null}
    {usesDateInputs ? <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span className="label" style={{ margin: 0 }}>统计区间</span>
      <input className="field" type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setRange("custom"); }} />
      <span style={{ color: "var(--ink-3)" }}>至</span>
      <input className="field" type="date" value={to} min={from} max={dateLimit} onChange={(event) => { setTo(event.target.value); setRange("custom"); }} />
      <button className="btn" data-size="sm" onClick={() => { setFrom(`${dateLimit.slice(0, 7)}-01`); setTo(dateLimit); setRange("custom"); }}>本月</button>
      <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 汇总口径</span>
    </div> : <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span className="label">统计区间</span>{OPTIONS.map(([id, label]) => <button key={id} className="btn" data-size="sm" data-variant={range === id ? "primary" : undefined} onClick={() => setRange(id)}>{label}</button>)}</div>}
    {loading ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>正在读取真实统计数据…</section> : null}
    {error ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--bad)" }}>{error}</section> : null}
    {!loading && !error && selectedGroup ? <RealMetricMatrix title={`${selectedGroup.name} · 区间汇总`} note={`${selectedGroup.period.from} 至 ${selectedGroup.period.to} 累计 · 总计比例按总数重新计算，不取个人比例平均值。`} columns={columns} /> : null}
    {!loading && !error && selectedGroup ? <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><h2 className="card-title">每日明细</h2><p className="card-note">所选区间内实际有填写记录的日期，最新日期排在最上面。</p></div>
        <span className="badge" data-tone="mute">共 {dayMatrices.length} 天</span>
      </div>
      {dayMatrices.map((day) => <RealMetricMatrix key={day.date} title={day.date} columns={day.columns} />)}
      {!dayMatrices.length ? <section className="card" style={{ padding: 44, textAlign: "center", color: "var(--ink-3)" }}>所选区间内没有每日明细</section> : null}
    </div> : null}
    {!loading && !error && !selectedGroup ? <RealEntityMetricsTable title="小组对比" note={`${data?.range.label ?? "当前区间"} · 选择一个具体小组后可以查看逐人明细。`} entityLabel="小组" rows={groupRows} /> : null}
  </div>;
}
