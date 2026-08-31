"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";

type Group = { id: string; name: string; active: boolean; leadId: string | null; leadName: string | null };
type Department = { id: string; name: string; timezone: string; groups: Group[] };
type Structure = { companies?: Array<{ departments: Department[] }>; unassignedDepartments?: Department[]; department?: Department | null };
type Candidate = { id: string; name: string; groupName: string; role: string; alreadyLead: boolean };
type Account = { id: string; name: string; username: string; role: string; duty: string | null; groupName: string | null; active: boolean };
type GroupReport = { id: string; activePeople: number };

const today = () => new Date().toISOString().slice(0, 10);
function makePassword() { const values = new Uint32Array(3); crypto.getRandomValues(values); return `Lead@${[...values].map((value) => value.toString(36)).join("").slice(0, 12)}9`; }
function normalize(payload: Structure): Department | null {
  return payload.department ?? payload.companies?.flatMap((company) => company.departments)[0] ?? payload.unassignedDepartments?.[0] ?? null;
}

export default function DepartmentGroupManagement() {
  const [department, setDepartment] = useState<Department | null>(null);
  const [reports, setReports] = useState<GroupReport[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [password, setPassword] = useState(makePassword);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [creatingLead, setCreatingLead] = useState<Group | null>(null);
  const [editing, setEditing] = useState<Group | null>(null);
  const [editName, setEditName] = useState("");
  const [changingLead, setChangingLead] = useState<Group | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState<Account | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [structure, reporting, managedAccounts] = await Promise.all([
        requestJson<Structure>("/api/org/structure"),
        requestJson<{ groups: GroupReport[] }>("/api/org/reporting?range=month"),
        requestJson<Account[]>("/api/org/accounts"),
      ]);
      setDepartment(normalize(structure)); setReports(reporting.groups); setAccounts(managedAccounts);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "小组管理数据读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!notice) return; const id = window.setTimeout(() => setNotice(""), 3500); return () => window.clearTimeout(id); }, [notice]);
  const peopleByGroup = useMemo(() => new Map(reports.map((group) => [group.id, group.activePeople])), [reports]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!department) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    setBusy(true); setError("");
    try {
      await requestJson("/api/org/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ departmentId: department.id, name }) });
      setCreateOpen(false); setNotice(`已创建小组“${name}”，现在可以单独开设组长账号`); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建失败"); }
    finally { setBusy(false); }
  }
  async function submitLeadAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!creatingLead) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("leadName") ?? "").trim();
    const username = String(form.get("username") ?? "").trim();
    const effectiveOn = String(form.get("effectiveOn") ?? today());
    setBusy(true); setError("");
    try {
      await requestJson("/api/org/group-leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: creatingLead.id, name, username, password, effectiveOn }) });
      setCreated({ username, password }); setCreatingLead(null); setNotice(`已为“${creatingLead.name}”创建组长账号`); setPassword(makePassword()); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "组长账号创建失败"); }
    finally { setBusy(false); }
  }
  async function saveName(event: FormEvent) {
    event.preventDefault(); if (!editing) return; setBusy(true); setError("");
    try { await requestJson("/api/org/groups", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editing.id, name: editName.trim() }) }); setNotice(`已修改小组名称`); setEditing(null); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "修改失败"); } finally { setBusy(false); }
  }
  async function openLead(group: Group) {
    setChangingLead(group); setCandidateId(""); setReason(""); setEffectiveOn(today()); setBusy(true); setError("");
    try { const result = await requestJson<{ candidates: Candidate[] }>(`/api/org/lead-candidates?groupId=${encodeURIComponent(group.id)}`); setCandidates(result.candidates); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "候选人读取失败"); } finally { setBusy(false); }
  }
  async function saveLead(event: FormEvent) {
    event.preventDefault(); if (!changingLead || !candidateId || reason.trim().length < 4) { setError("请选择候选人，并填写至少4个字的更换原因"); return; }
    setBusy(true); setError("");
    try {
      await requestJson(`/api/org/groups/${encodeURIComponent(changingLead.id)}/lead`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: candidateId, effectiveOn, reason: reason.trim(), formerDisposition: "DISABLE", formerTargetGroupId: changingLead.id }) });
      setNotice(effectiveOn > today() ? `已安排在 ${effectiveOn} 更换组长` : "组长已更换"); setChangingLead(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "更换组长失败"); } finally { setBusy(false); }
  }
  async function deleteAccount() {
    if (!deleting) return; setBusy(true); setError("");
    try { await requestJson("/api/org/accounts", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: deleting.id }) }); setNotice(`已删除误开账号“${deleting.name}”`); setDeleting(null); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "账号删除失败"); } finally { setBusy(false); }
  }

  if (loading) return <section className="fresh-sheet-card department-empty">正在读取真实小组与账号…</section>;
  return <div className="department-management">
    {notice ? <div className="team-management__notice"><span>✓</span>{notice}</div> : null}
    {created ? <div className="department-credentials"><strong>组长账号已创建，请立即保存</strong><span>账号：{created.username}</span><span>临时密码：{created.password}</span><button onClick={() => setCreated(null)}>我已保存</button></div> : null}
    {error && !createOpen && !creatingLead && !editing && !changingLead && !deleting ? <div className="department-error">{error}</div> : null}
    <div className="fresh-toolbar"><div className="fresh-history-intro"><strong>{department?.name ?? "本部门"}</strong><span>新组自动继承部门时区和全部启用渠道；历史小组不能直接删除</span></div><button className="fresh-primary" onClick={() => { setError(""); setCreateOpen(true); }}>＋ 开设新组</button></div>
    <section className="fresh-sheet-card department-group-list"><table><thead><tr><th>小组</th><th>当前组长</th><th>成员</th><th>状态</th><th>操作</th></tr></thead><tbody>{department?.groups.map((group) => <tr key={group.id}><td><strong>{group.name}</strong></td><td>{group.leadName ?? <em>待开设账号</em>}</td><td>{peopleByGroup.get(group.id) ?? 0}</td><td>{group.active ? "启用" : "停用"}</td><td><button onClick={() => { setEditing(group); setEditName(group.name); setError(""); }}>编辑名称</button>{group.leadId ? <button onClick={() => void openLead(group)}>更换组长</button> : <button onClick={() => { setCreatingLead(group); setPassword(makePassword()); setError(""); }}>开设组长账号</button>}</td></tr>)}</tbody></table></section>
    <section className="fresh-sheet-card department-accounts"><div className="fresh-sheet-title"><div><h2>本部门账号</h2><p>只有没有业务、设备和操作记录的误开账号才能永久删除</p></div><div><span>共</span><strong>{accounts.length} 个</strong></div></div><div className="department-table-wrap"><table><thead><tr><th>姓名</th><th>登录账号</th><th>身份</th><th>小组</th><th>状态</th><th>操作</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td>{account.name}</td><td>{account.username}</td><td>{account.duty ?? account.role}</td><td>{account.groupName ?? "—"}</td><td>{account.active ? "启用" : "停用"}</td><td><button onClick={() => { setDeleting(account); setError(""); }}>删除误开账号</button></td></tr>)}</tbody></table></div></section>
    {createOpen ? <div className="department-modal-backdrop"><form className="department-modal" onSubmit={submitCreate}><header><div><h2>第一步：开设新组</h2><p>这里只创建小组；创建成功后，再从小组列表单独开设组长账号</p></div><button type="button" onClick={() => setCreateOpen(false)}>×</button></header><label><span>小组名称</span><input name="name" required autoFocus /></label>{error ? <p className="department-error-text">{error}</p> : null}<footer><button type="button" onClick={() => setCreateOpen(false)}>取消</button><button className="fresh-primary" disabled={busy}>{busy ? "保存中…" : "确认创建小组"}</button></footer></form></div> : null}
    {creatingLead ? <div className="department-modal-backdrop"><form className="department-modal" onSubmit={submitLeadAccount}><header><div><h2>第二步：开设组长账号</h2><p>目标小组：{creatingLead.name}。只有尚无组长的小组可以开设。</p></div><button type="button" onClick={() => setCreatingLead(null)}>×</button></header><div className="department-lead-fields"><label><span>组长姓名</span><input name="leadName" required autoFocus /></label><label><span>登录用户名</span><input name="username" required /></label><label><span>生效日期</span><input name="effectiveOn" type="date" defaultValue={today()} required /></label><label><span>临时密码</span><div><input readOnly value={password} /><button type="button" onClick={() => setPassword(makePassword())}>重新生成</button></div></label></div>{error ? <p className="department-error-text">{error}</p> : null}<footer><button type="button" onClick={() => setCreatingLead(null)}>取消</button><button className="fresh-primary" disabled={busy}>{busy ? "创建中…" : "确认开设账号"}</button></footer></form></div> : null}
    {editing ? <div className="department-modal-backdrop"><form className="department-modal" onSubmit={saveName}><header><div><h2>编辑小组名称</h2><p>不会改变组长、成员和历史数据归属</p></div><button type="button" onClick={() => setEditing(null)}>×</button></header><label><span>小组名称</span><input value={editName} onChange={(event) => setEditName(event.target.value)} required autoFocus /></label>{error ? <p className="department-error-text">{error}</p> : null}<footer><button type="button" onClick={() => setEditing(null)}>取消</button><button className="fresh-primary" disabled={busy}>保存修改</button></footer></form></div> : null}
    {changingLead ? <div className="department-modal-backdrop"><form className="department-modal" onSubmit={saveLead}><header><div><h2>{changingLead.leadId ? "更换" : "任命"}组长 · {changingLead.name}</h2><p>历史数据保留；原组长工作账号默认停用</p></div><button type="button" onClick={() => setChangingLead(null)}>×</button></header><label><span>候选人员</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} required><option value="">请选择</option>{candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} · {candidate.groupName}{candidate.alreadyLead ? " · 现任组长" : ""}</option>)}</select></label><label><span>生效日期</span><input type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} required /></label><label><span>任命/调组原因</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="至少填写4个字" /></label>{error ? <p className="department-error-text">{error}</p> : null}<footer><button type="button" onClick={() => setChangingLead(null)}>取消</button><button className="fresh-primary" disabled={busy}>{busy ? "处理中…" : "确认"}</button></footer></form></div> : null}
    {deleting ? <div className="department-modal-backdrop"><section className="department-modal"><header><div><h2>删除误开账号 · {deleting.name}</h2><p>这是永久删除；有任何业务记录时系统会拒绝</p></div><button onClick={() => setDeleting(null)}>×</button></header><p>登录账号：<strong>{deleting.username}</strong></p>{error ? <p className="department-error-text">{error}</p> : null}<footer><button onClick={() => setDeleting(null)}>取消</button><button className="fresh-primary" disabled={busy} onClick={() => void deleteAccount()}>{busy ? "删除中…" : "确认删除"}</button></footer></section></div> : null}
  </div>;
}
