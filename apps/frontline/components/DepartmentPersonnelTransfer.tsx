"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import styles from "./DepartmentOperations.module.css";

type Role = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT" | "LEAD";
type Member = { id: string; name: string; role: Role; groupId: string; roleAssignments: Array<{ role: Role }> };
type Group = { id: string; name: string; department: { name: string }; members: Member[] };
type Preview = { groupChanged: boolean; counts: { reception: number; operator: number; expert: number }; movingCustomerCount: number; deviceCount: number; deviceAccountCount: number; conflicts: string[] };
const LABEL: Record<Role, string> = { RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家", LEAD: "组长" };
const FRONTLINE = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
const today = () => new Date().toISOString().slice(0, 10);

export default function DepartmentPersonnelTransfer() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [memberId, setMemberId] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [role, setRole] = useState<Role>("RECEPTION");
  const [secondaryRoles, setSecondaryRoles] = useState<Role[]>([]);
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [handoff, setHandoff] = useState({ reception: "", operator: "", expert: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const members = useMemo(() => groups.flatMap((group) => group.members), [groups]);
  const member = members.find((item) => item.id === memberId);
  const sourceGroup = groups.find((group) => group.id === member?.groupId);

  async function load() {
    const result = await requestJson<{ groups: Group[] }>("/api/admin/users/transfer");
    setGroups(result.groups);
  }
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "人员范围读取失败")); }, []);
  function resetPreview() { setPreview(null); setHandoff({ reception: "", operator: "", expert: "" }); }
  function chooseMember(id: string) {
    const selected = members.find((item) => item.id === id);
    setMemberId(id); resetPreview();
    if (!selected) return;
    setTargetGroupId(selected.groupId); setRole(selected.role);
    setSecondaryRoles(selected.role === "LEAD" ? [] : selected.roleAssignments.map((item) => item.role).filter((item) => item !== selected.role && FRONTLINE.includes(item as typeof FRONTLINE[number])));
  }
  function chooseRole(next: Role) { setRole(next); if (next === "LEAD") setSecondaryRoles([]); resetPreview(); }
  function candidates(expected: Role) { return sourceGroup?.members.filter((item) => item.id !== memberId && (item.role === expected || item.role === "LEAD" || item.roleAssignments.some((assignment) => assignment.role === expected))) ?? []; }
  function payload(mode: "preview" | "confirm") { return { mode, userId: memberId, targetGroupId, role, secondaryRoles, effectiveOn, reason, receptionHandoffId: handoff.reception || null, operatorHandoffId: handoff.operator || null, expertHandoffId: handoff.expert || null, expectedCounts: preview?.counts }; }
  async function run(mode: "preview" | "confirm") {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestJson<Preview & { ok: true }>("/api/admin/users/transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(mode)) });
      if (mode === "preview") setPreview(result);
      else { setNotice(result.groupChanged ? `调动完成：${result.movingCustomerCount} 位在办客户、${result.deviceCount} 台设备、${result.deviceAccountCount} 个账号已随人转入新组，历史仍留原组。` : "同组岗位调整完成，旧岗位历史已保留。"); setMemberId(""); resetPreview(); await load(); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "人员调动失败"); }
    finally { setBusy(false); }
  }
  const handoffMissing = preview && !preview.groupChanged && ((preview.counts.reception > 0 && !handoff.reception) || (preview.counts.operator > 0 && !handoff.operator) || (preview.counts.expert > 0 && !handoff.expert));
  return <div className={styles.page}>
    <section className={`fresh-sheet-card ${styles.intro}`}><article><strong>① 选择员工和目标小组</strong><span>跨组调动或只调整岗位都从这里办理。</span></article><article><strong>② 先预览影响</strong><span>系统列出在办客户、设备、账号和冲突。</span></article><article><strong>③ 确认后正式生效</strong><span>旧登录失效，历史客户与历史业绩不搬家。</span></article></section>
    {notice ? <div className={styles.success}>{notice}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
    <section className={`fresh-sheet-card ${styles.panel}`}><div className={styles.panelHead}><div><h2>人员调动与工作交接</h2><p>A 组调到 B 组，只搬仍在进行的工作和本人设备；过去的数据继续算在 A 组。</p></div></div>
      <div className={styles.filters}><select aria-label="选择调动员工" value={memberId} onChange={(event) => chooseMember(event.target.value)}><option value="">选择员工</option>{groups.map((group) => <optgroup key={group.id} label={group.name}>{group.members.map((item) => <option key={item.id} value={item.id}>{item.name} · {LABEL[item.role]}</option>)}</optgroup>)}</select><select aria-label="目标小组" value={targetGroupId} onChange={(event) => { setTargetGroupId(event.target.value); resetPreview(); }}><option value="">目标小组</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><select aria-label="调动后岗位" value={role} onChange={(event) => chooseRole(event.target.value as Role)}>{Object.entries(LABEL).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><input aria-label="生效日期" type="date" value={effectiveOn} onChange={(event) => { setEffectiveOn(event.target.value); resetPreview(); }} /><input aria-label="调动原因" value={reason} placeholder="调动原因（至少4个字）" onChange={(event) => { setReason(event.target.value); resetPreview(); }} /><button data-primary="true" disabled={busy || !memberId || !targetGroupId || reason.trim().length < 4} onClick={() => void run("preview")}>预览调动影响</button></div>
      {role !== "LEAD" ? <div className={styles.roles}><span className={styles.note}>兼任岗位：</span>{FRONTLINE.filter((item) => item !== role).map((item) => <label key={item}><input type="checkbox" checked={secondaryRoles.includes(item)} onChange={() => { setSecondaryRoles((current) => current.includes(item) ? current.filter((roleItem) => roleItem !== item) : [...current,item]); resetPreview(); }} />{LABEL[item]}</label>)}</div> : <span className={styles.note}>组长自带专家处理权限，不另选兼任岗位。</span>}
      {preview ? <div className={styles.preview}>{preview.groupChanged ? <><div className={styles.impact}><article><strong>{preview.movingCustomerCount}</strong><span>位在办客户随人转组</span></article><article><strong>{preview.deviceCount}</strong><span>台实体设备随人转组</span></article><article><strong>{preview.deviceAccountCount}</strong><span>个聊天账号随人转组</span></article></div><span className={styles.note}>历史客户和历史业绩继续归原小组，不会被覆盖。</span></> : <div className={styles.filters}>{(["reception","operator","expert"] as const).map((key) => { const expected = key === "reception" ? "RECEPTION" : key === "operator" ? "GROUP_OPERATOR" : "EXPERT"; return <select key={key} disabled={!preview.counts[key]} value={handoff[key]} onChange={(event) => setHandoff({ ...handoff, [key]: event.target.value })}><option value="">{LABEL[expected]}在办 {preview.counts[key]} · {preview.counts[key] ? "选接手人" : "无需交接"}</option>{candidates(expected).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>; })}</div>}{preview.conflicts.length ? <div className={styles.warning}>暂时不能调动：{preview.conflicts.join("；")}</div> : null}<button className={styles.action} data-primary="true" style={{ marginTop: 10 }} disabled={busy || preview.conflicts.length > 0 || Boolean(handoffMissing)} onClick={() => void run("confirm")}>确认办理调动</button></div> : null}
    </section>
  </div>;
}
