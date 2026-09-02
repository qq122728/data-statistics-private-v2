"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import { RealChannelReporting } from "./RealChannelReporting";
import { RealEntityMetricsTable, type RealMetrics } from "./RealMetricsTable";
import { RealOrganizationReporting } from "./RealOrganizationReporting";

type Scope = "department" | "company" | "hq";
type Tab = "summary" | "channel";
type Group = {
  id: string; name: string; timezone: string;
  activePeople: number;
  department: { id: string; name: string };
  company: { id: string; name: string } | null;
  totals: RealMetrics;
};
type Payload = { groups: Group[] };

const empty = (): RealMetrics => ({ added: 0, collision: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, depositCents: 0, withdrawalCents: 0, netCents: 0 });
function add(target: RealMetrics, value: RealMetrics) { for (const key of Object.keys(target) as Array<keyof RealMetrics>) target[key] += value[key] ?? 0; }
function rates(metrics: RealMetrics) {
  const abnormalBase = metrics.joined - metrics.leftNormal;
  return {
    replyRate: metrics.effective ? metrics.replied / metrics.effective : null,
    groupRate: metrics.effective ? metrics.joined / metrics.effective : null,
    abnormalLeaveRate: abnormalBase > 0 ? metrics.leftAbnormal / abnormalBase : null,
  };
}
function hasBusinessData(group: Group) { return group.activePeople > 0 || Object.values(group.totals).some((value) => value !== 0); }
function preferredGroup(groups: Group[], departmentId: string) {
  const candidates = groups.filter((group) => group.department.id === departmentId);
  return candidates.find(hasBusinessData) ?? candidates[0] ?? null;
}

function GroupTabs({ groupId }: { groupId: string }) {
  const [tab, setTab] = useState<Tab>("summary");
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {([['summary', '数据汇总'], ['channel', '渠道数据核对']] as Array<[Tab, string]>).map(([id, label]) => <button key={id} className="btn" data-variant={tab === id ? "primary" : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === "summary" ? <RealOrganizationReporting permissionLabel="只读 · 汇总口径" fixedGroupId={groupId} /> : null}
    {tab === "channel" ? <RealChannelReporting groupId={groupId} embedded /> : null}
  </div>;
}

export function OrganizationDetailWorkspace({ scope }: { scope: Scope }) {
  const [data, setData] = useState<Payload | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [companyMode, setCompanyMode] = useState<"departments" | "department">("departments");
  const [departmentMode, setDepartmentMode] = useState<"groups" | "group">(scope === "department" ? "group" : "groups");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void requestJson<Payload>("/api/org/reporting?range=month").then((payload) => {
      if (cancelled) return;
      setData(payload);
      const firstCompany = payload.groups.find((group) => group.company)?.company?.id ?? "";
      const effectiveCompany = scope === "hq" ? firstCompany : payload.groups[0]?.company?.id ?? "";
      const firstDepartment = payload.groups.find((group) => !effectiveCompany || group.company?.id === effectiveCompany)?.department.id ?? "";
      const firstGroup = preferredGroup(payload.groups, firstDepartment)?.id ?? "";
      setCompanyId(effectiveCompany); setDepartmentId(firstDepartment); setGroupId(firstGroup);
    }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "组织明细读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);

  const groups = data?.groups ?? [];
  const companies = useMemo(() => [...new Map(groups.flatMap((group) => group.company ? [[group.company.id, group.company.name] as const] : [])).entries()].map(([id, name]) => ({ id, name })), [groups]);
  const departments = useMemo(() => [...new Map(groups.filter((group) => !companyId || group.company?.id === companyId).map((group) => [group.department.id, group.department.name] as const)).entries()].map(([id, name]) => ({ id, name })), [groups, companyId]);
  const departmentGroups = groups.filter((group) => group.department.id === departmentId);

  const departmentRows = useMemo(() => departments.map((department) => {
    const metrics = empty();
    groups.filter((group) => group.department.id === department.id).forEach((group) => add(metrics, group.totals));
    return { id: department.id, name: department.name, metrics, rates: rates(metrics) };
  }), [departments, groups]);
  const groupRows = departmentGroups.map((group) => ({ id: group.id, name: group.name, metrics: group.totals, rates: rates(group.totals) }));

  function chooseCompany(next: string) {
    setCompanyId(next); setCompanyMode("departments"); setDepartmentMode("groups");
    const nextDepartment = groups.find((group) => group.company?.id === next)?.department.id ?? "";
    setDepartmentId(nextDepartment); setGroupId(groups.find((group) => group.department.id === nextDepartment)?.id ?? "");
  }
  function chooseDepartment(next: string) {
    setDepartmentId(next); setDepartmentMode("groups"); setGroupId(preferredGroup(groups, next)?.id ?? "");
  }

  if (loading) return <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>正在读取组织明细…</section>;
  if (error) return <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--bad)" }}>{error}</section>;

  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    {scope === "hq" ? <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span className="label" style={{ margin: 0 }}>选择公司</span><select className="field" value={companyId} onChange={(event) => chooseCompany(event.target.value)}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select><span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 总公司口径</span></div>
      <div style={{ display: "flex", gap: 8 }}><button className="btn" data-variant={companyMode === "departments" ? "primary" : undefined} onClick={() => setCompanyMode("departments")}>公司内部门对比</button><button className="btn" data-variant={companyMode === "department" ? "primary" : undefined} onClick={() => setCompanyMode("department")}>部门明细</button></div>
    </> : null}

    {scope === "hq" && companyMode === "departments" ? <RealEntityMetricsTable title="部门汇总" note="本公司各部门并排对比；每一行按自己的小组统计汇总。" entityLabel="部门" rows={departmentRows} /> : null}

    {(scope !== "hq" || companyMode === "department") && scope !== "department" ? <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span className="label" style={{ margin: 0 }}>选择部门</span><select className="field" value={departmentId} onChange={(event) => chooseDepartment(event.target.value)}>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select><span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 公司口径</span></div>
      <div style={{ display: "flex", gap: 8 }}><button className="btn" data-variant={departmentMode === "groups" ? "primary" : undefined} onClick={() => setDepartmentMode("groups")}>部门内小组对比</button><button className="btn" data-variant={departmentMode === "group" ? "primary" : undefined} onClick={() => setDepartmentMode("group")}>小组明细</button></div>
    </> : null}

    {(scope === "department" || ((scope !== "hq" || companyMode === "department") && departmentMode === "group")) ? <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><span className="label" style={{ margin: 0 }}>选择小组</span><select className="field" value={groupId} onChange={(event) => setGroupId(event.target.value)}>{departmentGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 部门口径</span></div>
      {groupId ? <GroupTabs key={groupId} groupId={groupId} /> : <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>当前部门还没有小组</section>}
    </> : null}

    {(scope !== "department" && (scope !== "hq" || companyMode === "department") && departmentMode === "groups") ? <RealEntityMetricsTable title="团队汇总" note="所选部门内各小组并排对比。" entityLabel="小组" rows={groupRows} /> : null}
  </div>;
}
