"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";

type Role = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT" | "LEAD";
type Member = { id: string; name: string; role: Role; duty: string | null; groupId: string; roleAssignments: Array<{ role: Role }> };
type Group = { id: string; name: string; departmentId: string; department: { name: string; companyId: string | null; company: { name: string } | null }; members: Member[] };
type Preview = { counts: { reception: number; operator: number; expert: number }; customerCount: number; deviceAccountCount: number };
const labels: Record<Role, string> = { RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家", LEAD: "组长" };
const frontlineRoles = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;

export function PersonnelTransferPanel({ onToast }: { onToast: (message: string, tone?: "ok" | "warn") => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [memberId, setMemberId] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [role, setRole] = useState<Role>("RECEPTION");
  const [secondaryRoles, setSecondaryRoles] = useState<Role[]>([]);
  const [effectiveOn, setEffectiveOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [handoff, setHandoff] = useState({ reception: "", operator: "", expert: "" });
  const [busy, setBusy] = useState(false);
  const members = useMemo(() => groups.flatMap((group) => group.members), [groups]);
  const member = members.find((item) => item.id === memberId);
  const sourceGroup = groups.find((group) => group.id === member?.groupId);

  function selectMember(nextMemberId: string) {
    const selected = members.find((item) => item.id === nextMemberId);
    setMemberId(nextMemberId);
    if (selected) {
      setTargetGroupId(selected.groupId);
      setRole(selected.role);
      setSecondaryRoles(
        selected.role === "LEAD"
          ? []
          : selected.roleAssignments
              .map((assignment) => assignment.role)
              .filter((assignedRole): assignedRole is (typeof frontlineRoles)[number] =>
                assignedRole !== selected.role && frontlineRoles.includes(assignedRole as (typeof frontlineRoles)[number]),
              ),
      );
    }
    resetPreview();
  }

  function selectPrimaryRole(nextRole: Role) {
    const currentlyAssigned = new Set<Role>([role, ...secondaryRoles]);
    setRole(nextRole);
    setSecondaryRoles(
      nextRole === "LEAD"
        ? []
        : frontlineRoles.filter((assignedRole) => assignedRole !== nextRole && currentlyAssigned.has(assignedRole)),
    );
    resetPreview();
  }

  function toggleSecondaryRole(nextRole: (typeof frontlineRoles)[number]) {
    setSecondaryRoles((current) => current.includes(nextRole) ? current.filter((item) => item !== nextRole) : [...current, nextRole]);
    resetPreview();
  }

  async function load() {
    const result = await requestJson<{ groups: Group[] }>("/api/admin/users/transfer");
    setGroups(result.groups);
  }
  useEffect(() => { void load().catch((error) => onToast(error instanceof Error ? error.message : "人员范围读取失败", "warn")); }, []);
  function resetPreview() { setPreview(null); setHandoff({ reception: "", operator: "", expert: "" }); }
  function candidates(expected: Role) {
    return sourceGroup?.members.filter((item) => item.id !== memberId && (item.role === expected || item.role === "LEAD" || item.roleAssignments.some((assignment) => assignment.role === expected))) ?? [];
  }
  function payload(mode: "preview" | "confirm") {
    return {
      mode, userId: memberId, targetGroupId, role, secondaryRoles, effectiveOn, reason,
      receptionHandoffId: handoff.reception || null, operatorHandoffId: handoff.operator || null, expertHandoffId: handoff.expert || null,
      expectedCounts: preview?.counts,
    };
  }
  async function run(mode: "preview" | "confirm") {
    setBusy(true);
    try {
      const result = await requestJson<Preview & { ok: true }>("/api/admin/users/transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(mode)) });
      if (mode === "preview") setPreview(result);
      else { onToast("人员调动已完成，旧岗位和小组历史已保留"); setMemberId(""); resetPreview(); await load(); }
    } catch (error) { onToast(error instanceof Error ? error.message : "人员调动失败", "warn"); }
    finally { setBusy(false); }
  }
  return <div className="card" style={{ padding: 16, marginTop: 14 }}>
    <h2 className="card-title">人员调岗与跨组调动</h2>
    <p className="card-note">先预览接粉、炒群、专家三个阶段的在办客户，再分别选择合法接手人。确认后保留原岗位、小组和历史业绩。</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 14 }}>
      <select className="field" value={memberId} onChange={(e) => selectMember(e.target.value)}><option value="">选择员工</option>{groups.map((group) => <optgroup key={group.id} label={`${group.department.name} / ${group.name}`}>{group.members.map((item) => <option key={item.id} value={item.id}>{item.name} · {labels[item.role]}</option>)}</optgroup>)}</select>
      <select className="field" value={targetGroupId} onChange={(e) => { setTargetGroupId(e.target.value); resetPreview(); }}><option value="">目标小组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.department.company?.name ? `${group.department.company.name} / ` : ""}{group.department.name} / {group.name}</option>)}</select>
      <select className="field" value={role} onChange={(e) => selectPrimaryRole(e.target.value as Role)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {role === "LEAD" ? <div className="card-note">组长按业务规则自带专家处理权限，不另设一线兼任岗位</div> : <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">兼任岗位（可多选）</legend><div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 5 }}>{frontlineRoles.filter((item) => item !== role).map((item) => <label key={item} className="label" style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={secondaryRoles.includes(item)} onChange={() => toggleSecondaryRole(item)} />兼任{labels[item]}</label>)}</div></fieldset>}
      <input className="field" type="date" value={effectiveOn} onChange={(e) => { setEffectiveOn(e.target.value); resetPreview(); }} />
      <input className="field" placeholder="调动原因（至少4个字）" value={reason} onChange={(e) => { setReason(e.target.value); resetPreview(); }} />
      <button className="btn" data-variant="primary" disabled={busy || !memberId || !targetGroupId || reason.trim().length < 4} onClick={() => void run("preview")}>预览在办客户</button>
    </div>
    {preview ? <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(180px,1fr))", gap: 10 }}>
        {(["reception", "operator", "expert"] as const).map((key) => { const expected = key === "reception" ? "RECEPTION" : key === "operator" ? "GROUP_OPERATOR" : "EXPERT"; return <label key={key} className="label">{labels[expected]}在办 {preview.counts[key]}<select className="field" style={{ width: "100%", marginTop: 5 }} disabled={!preview.counts[key]} value={handoff[key]} onChange={(e) => setHandoff({ ...handoff, [key]: e.target.value })}><option value="">{preview.counts[key] ? "选择原组接手人" : "无需交接"}</option>{candidates(expected).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>; })}
      </div>
      <button className="btn" data-variant="primary" data-confirm-action="确认办理人员调动？此操作会使该员工旧会话失效。" style={{ marginTop: 12 }} disabled={busy || (preview.counts.reception > 0 && !handoff.reception) || (preview.counts.operator > 0 && !handoff.operator) || (preview.counts.expert > 0 && !handoff.expert)} onClick={() => void run("confirm")}>确认办理调动</button>
    </div> : null}
  </div>;
}
