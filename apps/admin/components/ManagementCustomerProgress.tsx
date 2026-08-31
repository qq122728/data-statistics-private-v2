"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import { RealCustomerProgress } from "./RealCustomerProgress";

type Group = { id: string; name: string; department: { id: string; name: string }; company: { id: string; name: string } | null };

const UNASSIGNED_COMPANY_ID = "__unassigned_company__";
function groupCompanyId(group: Group) { return group.company?.id ?? UNASSIGNED_COMPANY_ID; }
function groupCompanyName(group: Group) { return group.company?.name ?? "未归属公司"; }

/** 管理员独立的只读客户进度入口；不渲染任何统计数字。 */
export function ManagementCustomerProgress({ permissionLabel }: { permissionLabel: string }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void requestJson<{ groups: Group[] }>("/api/org/reporting?range=month")
      .then((payload) => {
        if (cancelled) return;
        setGroups(payload.groups);
        const companyIds = [...new Set(payload.groups.map(groupCompanyId))];
        setCompanyId((current) => companyIds.includes(current) ? current : companyIds.length === 1 ? companyIds[0] : "");
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "可查看小组读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const companies = useMemo(() => {
    const values = new Map<string, string>();
    groups.forEach((group) => values.set(groupCompanyId(group), groupCompanyName(group)));
    return [...values].map(([id, name]) => ({ id, name }));
  }, [groups]);
  const departments = useMemo(() => {
    const values = new Map<string, string>();
    groups.filter((group) => !companyId || groupCompanyId(group) === companyId)
      .forEach((group) => values.set(group.department.id, group.department.name));
    return [...values].map(([id, name]) => ({ id, name }));
  }, [groups, companyId]);
  const visibleGroups = groups.filter((group) =>
    (!companyId || groupCompanyId(group) === companyId) && (!departmentId || group.department.id === departmentId));
  const selectedGroup = groups.find((group) => group.id === groupId);

  return <div style={{ display: "grid", gap: 14 }}>
    <section className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
        <div><h2 className="card-title">客户进度范围</h2><p className="card-note">{permissionLabel}。这里只看客户通讯录和当前跟进阶段，不显示、不修改每日统计。</p></div>
        <span className="badge" data-tone="mute">只读</span>
      </div>
      {error ? <div className="notice" data-tone="bad" style={{ marginTop: 12 }}>{error}</div> : null}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 9, marginTop: 14 }}>
        <label className="label" style={{ margin: 0 }}>公司</label>
        <select className="field" value={companyId} disabled={loading || companies.length <= 1} onChange={(event) => { setCompanyId(event.target.value); setDepartmentId(""); setGroupId(""); }}><option value="">全部公司</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>
        <span className="muted">→</span>
        <label className="label" style={{ margin: 0 }}>部门</label>
        <select className="field" value={departmentId} disabled={loading} onChange={(event) => { setDepartmentId(event.target.value); setGroupId(""); }}><option value="">全部部门</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
        <span className="muted">→</span>
        <label className="label" style={{ margin: 0 }}>小组</label>
        <select className="field" value={groupId} disabled={loading} onChange={(event) => setGroupId(event.target.value)}><option value="">请选择具体小组</option>{visibleGroups.map((group) => <option key={group.id} value={group.id}>{departmentId ? group.name : `${group.department.name} / ${group.name}`}</option>)}</select>
      </div>
      {selectedGroup ? <div className="muted" style={{ marginTop: 10 }}>当前查看：{groupCompanyName(selectedGroup)} / {selectedGroup.department.name} / {selectedGroup.name}</div> : null}
    </section>
    {loading ? <section className="card" style={{ padding: 42, textAlign: "center", color: "var(--ink-3)" }}>正在读取权限范围…</section>
      : groupId ? <RealCustomerProgress members={[]} readOnly groupId={groupId} />
      : <section className="card" style={{ padding: 52, textAlign: "center", color: "var(--ink-3)" }}>先选择一个具体小组，再查看该组客户进度</section>}
  </div>;
}
