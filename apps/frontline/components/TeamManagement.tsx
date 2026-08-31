"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson, type BackendUser } from "@/lib/backend";
import type { InspectorMember } from "@/components/MemberDataInspector";

type TeamMember = {
  id: string;
  name: string;
  username: string;
  role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  roles: Array<"RECEPTION" | "GROUP_OPERATOR" | "EXPERT">;
  expert: boolean;
  filledToday: boolean;
  clients: number;
  devices: number;
  active: boolean;
};

export type TeamAuditRow = { time: string; member: string; target: string; before: string; after: string; operator: string; reason: string };

type MemberDraft = { name: string; username: string; expert: boolean; password: string };
const emptyDraft: MemberDraft = { name: "", username: "", expert: false, password: "" };

export default function TeamManagement({ user, externalAudits = [], onInspect }: { user: BackendUser; externalAudits?: TeamAuditRow[]; onInspect: (member: InspectorMember) => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [memberLoadError, setMemberLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemberDraft>(emptyDraft);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState(user.id);
  const [handoverReason, setHandoverReason] = useState("");
  const [notice, setNotice] = useState("");
  const activeMembers = useMemo(() => members.filter((member) => member.active), [members]);
  const filledCount = activeMembers.filter((member) => member.filledToday).length;
  const clientCount = activeMembers.reduce((sum, member) => sum + member.clients, 0);
  const deviceCount = activeMembers.reduce((sum, member) => sum + member.devices, 0);
  const editingMember = members.find((member) => member.id === editingId) ?? null;
  const handoverTargets = useMemo(() => [{ id: user.id, name: user.name }, ...activeMembers.map(({ id, name }) => ({ id, name }))], [activeMembers, user.id, user.name]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setMemberLoadError("");
    try {
      const rows = await requestJson<Array<{ id: string; name: string; username: string; active: boolean; role: TeamMember["role"]; roleAssignments?: Array<{ role: TeamMember["role"] }>; filledToday: boolean; clients: number; devices: number }>>("/api/lead/members");
      const nextMembers = rows.map((row) => {
        const roles = [...new Set([row.role, ...(row.roleAssignments ?? []).map((assignment) => assignment.role)])];
        return { id: row.id, name: row.name, username: row.username, role: row.role, roles, expert: roles.includes("EXPERT"), filledToday: row.filledToday, clients: row.clients, devices: row.devices, active: row.active };
      });
      setMembers(nextMembers);
      const first = nextMembers[0];
      if (first) setFromId(first.id); else setFromId("");
      setToId(user.id);
    } catch (caught) {
      setMembers([]);
      setFromId("");
      setToId(user.id);
      setMemberLoadError(caught instanceof Error ? caught.message : "成员列表读取失败");
    } finally { setLoading(false); }
  }, [user.id]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  function openCreate() {
    setDraft(emptyDraft);
    setEditingId("new");
  }

  function openEdit(member: TeamMember) {
    setDraft({ name: member.name, username: member.username, expert: member.expert, password: "" });
    setEditingId(member.id);
  }

  async function saveMember(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.username.trim()) return;
    setSaving(true); setMemberLoadError("");
    try {
      if (editingId === "new") {
        await requestJson("/api/lead/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: draft.name.trim(), username: draft.username.trim(), password: draft.password, role: "RECEPTION", secondaryRoles: draft.expert ? ["EXPERT"] : [] }) });
        setNotice(`已开通 ${draft.name.trim()} 的组员账号；默认可以使用本组全部启用渠道。`);
      } else if (editingMember) {
        const secondaryRoles = draft.expert && !editingMember.expert ? [...new Set([...editingMember.roles.filter((role) => role !== editingMember.role), "EXPERT"])] : undefined;
        await requestJson("/api/lead/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingMember.id, name: draft.name.trim(), username: draft.username.trim(), ...(secondaryRoles ? { secondaryRoles } : {}) }) });
        setNotice(`已保存 ${draft.name.trim()} 的账号设置。`);
      }
      setEditingId(null);
      await loadMembers();
    } catch (caught) { setMemberLoadError(caught instanceof Error ? caught.message : "成员保存失败"); }
    finally { setSaving(false); }
  }

  async function toggleMember(member: TeamMember) {
    setSaving(true); setMemberLoadError("");
    try {
      await requestJson("/api/lead/members", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: member.id, active: !member.active }) });
      setNotice(`${member.name} 的工作账号已${member.active ? "停用" : "重新启用"}，历史数据没有删除。`);
      await loadMembers();
    } catch (caught) { setMemberLoadError(caught instanceof Error ? caught.message : "账号状态更新失败"); }
    finally { setSaving(false); }
  }

  async function confirmHandover() {
    const source = members.find((member) => member.id === fromId);
    const target = handoverTargets.find((member) => member.id === toId);
    if (!source || !target || source.id === target.id || handoverReason.trim().length < 4) return;
    setSaving(true); setMemberLoadError("");
    try {
      const result = await requestJson<{ transferred: { reception: number; operator: number; expert: number; physicalDevices: number; deviceAccounts: number } }>("/api/lead/members/handover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: source.id, targetId: target.id, reason: handoverReason.trim() }) });
      const customerTotal = result.transferred.reception + result.transferred.operator + result.transferred.expert;
      setNotice(`交接完成：${source.name} 的 ${customerTotal} 位在办客户和 ${result.transferred.physicalDevices + result.transferred.deviceAccounts} 个设备/账号已转给 ${target.name}。历史数据仍归原成员。`);
      setHandoverReason("");
      await loadMembers();
    } catch (caught) { setMemberLoadError(caught instanceof Error ? caught.message : "工作交接失败"); }
    finally { setSaving(false); }
  }

  return <div className="team-management">
    <div className="team-management__topline">
      <div><strong>{user.groupName || "所属小组"}</strong><span>组长只管理本组；所有成员默认使用本组全部启用渠道</span></div>
      <button className="fresh-primary" disabled={saving} onClick={openCreate}>＋ 开通组员账号</button>
    </div>

    {notice ? <div className="team-management__notice"><span>✓</span>{notice}<button onClick={() => setNotice("")}>×</button></div> : null}
    {memberLoadError ? <div className="team-management__notice"><span>!</span>{memberLoadError}</div> : null}

    <div className="team-kpis">
      <article><span>启用组员</span><strong>{activeMembers.length}</strong><small>不含组长本人</small></article>
      <article><span>今日已填写</span><strong>{filledCount}/{activeMembers.length}</strong><small>{activeMembers.length - filledCount} 人尚未填写</small></article>
      <article><span>在办客户</span><strong>{clientCount}</strong><small>组内共享跟进</small></article>
      <article><span>设备账号</span><strong>{deviceCount}</strong><small>RCS、SIG 等平台</small></article>
    </div>

    <section className="team-panel">
      <header><div><h2>成员管理</h2><p>普通组员拥有同一套工作台；“专家”是附加权限，不是另一种账号。</p></div><span>{activeMembers.length} 人启用</span></header>
      <div className="team-table-wrap"><table className="team-table">
        <thead><tr><th>成员</th><th>登录用户名</th><th>权限</th><th>今日填写</th><th>在办客户</th><th>设备</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={8}>正在读取本组成员…</td></tr> : members.length === 0 ? <tr><td colSpan={8}>{memberLoadError ? "成员读取失败，请刷新后重试" : "本组暂无组员"}</td></tr> : members.map((member) => <tr key={member.id} data-inactive={!member.active}>
          <td><div className="team-person"><i>{member.name.slice(0, 1)}</i><div><strong>{member.name}</strong><small>组员</small></div></div></td>
          <td>{member.username}</td>
          <td><span className="team-tag">组员</span>{member.roles.includes("GROUP_OPERATOR") ? <span className="team-tag">炒群</span> : null}{member.expert ? <span className="team-tag" data-tone="expert">专家</span> : null}</td>
          <td><span className="team-state" data-tone={member.filledToday ? "ok" : "warn"}>{member.filledToday ? "已填写" : "未填写"}</span></td>
          <td>{member.clients}</td><td>{member.devices}</td>
          <td><span className="team-state" data-tone={member.active ? "ok" : "off"}>{member.active ? "启用" : "停用"}</span></td>
          <td><div className="team-actions"><button onClick={() => onInspect({ id: member.id, name: member.name })}>查数据</button><button disabled={saving} onClick={() => openEdit(member)}>管理</button><button disabled={saving} data-danger={member.active} onClick={() => void toggleMember(member)}>{member.active ? "停用" : "启用"}</button></div></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <div className="team-management__split">
      <section className="team-panel team-handover">
        <header><div><h2>人员调动与工作交接</h2><p>只转移当前还在进行的客户和设备，原成员历史数据保持不动。</p></div></header>
        <div className="team-handover__flow">
          <label><span>原负责人</span><select value={fromId} onChange={(event) => setFromId(event.target.value)}>{members.filter((member) => member.id !== user.id).map((member) => <option key={member.id} value={member.id}>{member.name} · {member.clients} 客户 / {member.devices} 设备</option>)}</select></label>
          <b>→</b>
          <label><span>新负责人</span><select value={toId} onChange={(event) => setToId(event.target.value)}>{handoverTargets.filter((member) => member.id !== fromId).map((member) => <option key={member.id} value={member.id}>{member.name}{member.id === user.id ? " · 组长" : ""}</option>)}</select></label>
        </div>
        <label className="team-reason"><span>交接原因</span><textarea value={handoverReason} onChange={(event) => setHandoverReason(event.target.value)} placeholder="至少填写 4 个字，方便以后追查" /></label>
        <div className="team-handover__footer"><span>客户、设备一次性交接；历史业绩不会改名</span><button className="fresh-primary" disabled={saving || !fromId || fromId === toId || handoverReason.trim().length < 4} onClick={() => void confirmHandover()}>确认交接</button></div>
      </section>

      <section className="team-panel team-missing">
        <header><div><h2>今日待处理</h2><p>组长每天优先看这里。</p></div></header>
        <div className="team-task"><i data-tone={activeMembers.length - filledCount > 0 ? "warn" : "ok"}>!</i><div><strong>{activeMembers.length - filledCount} 人尚未填写当日数据</strong><span>{activeMembers.filter((member) => !member.filledToday).map((member) => member.name).join("、") || "全部已填写"}</span></div>{activeMembers.some((member) => !member.filledToday) ? <button onClick={() => { const target = activeMembers.find((member) => !member.filledToday); if (target) onInspect({ id: target.id, name: target.name }); }}>查看</button> : null}</div>
      </section>
    </div>

    <section className="team-panel">
      <header><div><h2>数据修改记录</h2><p>组长帮助纠错时，系统保留修改前后数字、操作人和原因。</p></div><button className="team-outline" onClick={() => { const target = members.find((member) => member.id !== user.id) ?? members[0]; if (target) onInspect({ id: target.id, name: target.name }); }}>检查成员数据</button></header>
      <div className="team-table-wrap"><table className="team-table team-audit-table"><thead><tr><th>时间</th><th>数据归属</th><th>修改项目</th><th>修改前</th><th>修改后</th><th>操作人</th><th>原因</th></tr></thead><tbody>{externalAudits.length ? externalAudits.map((row, index) => <tr key={`${row.time}-${row.member}-${index}`}><td>{row.time}</td><td>{row.member}</td><td>{row.target}</td><td>{row.before}</td><td><strong>{row.after}</strong></td><td>{row.operator}</td><td>{row.reason}</td></tr>) : <tr><td colSpan={7}>暂无真实数据修改记录</td></tr>}</tbody></table></div>
    </section>

    {editingId ? <div className="team-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingId(null); }}>
      <form className="team-dialog" onSubmit={saveMember}>
        <header><div><h2>{editingId === "new" ? "开通组员账号" : `管理成员 · ${editingMember?.name || ""}`}</h2><p>新成员默认拥有本组全部启用渠道。</p></div><button type="button" onClick={() => setEditingId(null)}>×</button></header>
        <label><span>成员姓名</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
        <label><span>登录用户名</span><input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} required /></label>
        {editingId === "new" ? <label><span>初始密码</span><input type="password" value={draft.password} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} placeholder="首次登录后要求修改" required minLength={12} /></label> : null}
        <label className="team-check"><input type="checkbox" checked={draft.expert} disabled={Boolean(editingMember?.expert)} onChange={(event) => setDraft((current) => ({ ...current, expert: event.target.checked }))} /><span><strong>增加专家权限</strong><small>{editingMember?.expert ? "已有专家岗位；如需取消，请通过人员调岗并交接在办客户。" : "保留普通组员功能，同时兼任专家岗位。"}</small></span></label>
        <div className="team-dialog__note">全部渠道自动可用，不需要逐个分配。</div>
        <footer><button type="button" disabled={saving} onClick={() => setEditingId(null)}>取消</button><button className="fresh-primary" disabled={saving}>{saving ? "保存中…" : editingId === "new" ? "开通账号" : "保存修改"}</button></footer>
      </form>
    </div> : null}
  </div>;
}
