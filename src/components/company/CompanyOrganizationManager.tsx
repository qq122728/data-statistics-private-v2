"use client";

import { ArrowsLeftRight, CheckCircle, Circle, PencilSimple, Plus, X } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";
import { BUSINESS_TIMEZONE_OPTIONS, businessTimezoneOption } from "../../lib/business-time-config";
import { MemberTransferDialog, type TransferMember } from "../admin/MemberTransferDialog";

export type CompanyManagedGroup = { id: string; name: string; active: boolean; timezone: string | null; effectiveTimezone: string; effectiveCountryCode: string; inheritedTimezone: boolean; localTime: string; label: string; leadCount: number; memberCount: number };
export type CompanyManagedLead = { id: string; username: string; name: string; groupId: string | null; active: boolean; lastLoginAt: string | null; group: { id: string; name: string; active: boolean } | null };
export type CompanyDepartmentManager = { id: string; username: string; name: string; active: boolean; managementScopeName: string | null; managementCountryCode: string | null; lastLoginAt: string | null };

async function mutate(url: string, method: "POST" | "PATCH", body: object) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "操作失败，请稍后重试");
  return result;
}

const lastLogin = (value: string | null) => value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "从未登录";
const countryLabel = (code: string) => {
  try { return `${new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code}（${code}）`; }
  catch { return code; }
};

export function CompanyOrganizationManager({ companyName, companyTimezone, groups, leads, members, departmentManagers, businessDate, managementScopeName, managementCountryCode }: { companyName: string; companyTimezone: string; groups: CompanyManagedGroup[]; leads: CompanyManagedLead[]; members: TransferMember[]; departmentManagers: CompanyDepartmentManager[]; businessDate: string; managementScopeName: string | null; managementCountryCode: string | null }) {
  const router = useRouter();
  const [groupEditor, setGroupEditor] = useState<CompanyManagedGroup | "new" | null>(null);
  const [leadEditor, setLeadEditor] = useState<CompanyManagedLead | "new" | null>(null);
  const [resetLead, setResetLead] = useState<CompanyManagedLead | null>(null);
  const [transferMember, setTransferMember] = useState<TransferMember | null>(null);
  const [departmentManagerOpen, setDepartmentManagerOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeGroups = groups.filter((group) => group.active);
  const countryOptions = [...new Set(activeGroups.map((group) => group.effectiveCountryCode))].sort();
  const isDepartmentManager = Boolean(managementCountryCode);
  const selectedGroup = groupEditor === "new" ? null : groupEditor;
  const selectedLead = leadEditor === "new" ? null : leadEditor;

  async function run(action: () => Promise<unknown>, success: string, close: () => void) {
    setBusy(true); setError("");
    try { await action(); setNotice(success); close(); router.refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试"); }
    finally { setBusy(false); }
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    const timezone = String(new FormData(event.currentTarget).get("timezone") ?? "");
    await run(
      () => mutate("/api/company/groups", selectedGroup ? "PATCH" : "POST", selectedGroup ? { id: selectedGroup.id, name, timezone } : { name, timezone }),
      selectedGroup ? `已更新小组“${name}”` : `已创建小组“${name}”`,
      () => setGroupEditor(null),
    );
  }

  async function saveLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { name: String(form.get("name") ?? ""), username: String(form.get("username") ?? ""), groupId: String(form.get("groupId") ?? ""), ...(selectedLead ? {} : { password: String(form.get("password") ?? "") }) };
    await run(
      () => mutate("/api/company/leads", selectedLead ? "PATCH" : "POST", selectedLead ? { id: selectedLead.id, ...body } : body),
      selectedLead ? `已更新组长“${body.name}”` : `已创建组长账号“${body.name}”`,
      () => setLeadEditor(null),
    );
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetLead) return;
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    await run(() => mutate("/api/company/leads", "PATCH", { id: resetLead.id, password }), `已重置组长“${resetLead.name}”的密码，原登录已退出`, () => setResetLead(null));
  }

  function requestStatus(lead: CompanyManagedLead) {
    const nextActive = !lead.active;
    setConfirmation({
      title: nextActive ? "确认重新启用组长账号" : "确认停用组长账号",
      description: nextActive ? "重新启用后，该组长可以登录并继续管理本组前台账号。" : "停用后，该组长会退出系统且不能继续管理本组账号。历史数据不会删除。",
      confirmLabel: nextActive ? "确认启用" : "确认停用",
      target: `${lead.name} · ${lead.group?.name ?? "未分组"}`,
      tone: nextActive ? "primary" : "danger",
      onConfirm: async () => run(() => mutate("/api/company/leads", "PATCH", { id: lead.id, active: nextActive }), `已${nextActive ? "启用" : "停用"}组长“${lead.name}”`, () => setConfirmation(null)),
    });
  }

  async function transfer(body: object) {
    if (!transferMember) return;
    await mutate("/api/admin/users/transfer", "POST", body);
    setNotice(`已办理“${transferMember.name}”的人员调动，旧客户和旧业绩仍保留在原小组`);
    setTransferMember(null);
    router.refresh();
  }

  async function createDepartmentManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = { name: String(form.get("name") ?? ""), username: String(form.get("username") ?? ""), password: String(form.get("password") ?? ""), managementScopeName: String(form.get("managementScopeName") ?? ""), managementCountryCode: String(form.get("managementCountryCode") ?? "") };
    await run(() => mutate("/api/company/department-managers", "POST", body), `已创建部门管理员“${body.name}”`, () => setDepartmentManagerOpen(false));
  }

  return <main className="page-shell space-y-4">
    <div className="page-heading"><div><h1 className="page-title">{isDepartmentManager ? `${managementScopeName ?? "部门"}管理` : "公司组织管理"}</h1><p className="page-description">{isDepartmentManager ? `仅查看和操作“${companyName}”下 ${managementScopeName ?? managementCountryCode} 范围内的小组、人员和数据。` : `管理“${companyName}”下面的部门、小组和组长账号。`}</p></div></div>
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">权限链：总公司管理员创建公司管理员 → 公司管理员可创建部门管理员、小组和组长 → 部门管理员只管理绑定市场 → 组长管理本组成员。</div>
    {notice ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}
    {error && !groupEditor && !leadEditor && !resetLead && !confirmation ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">本公司小组</h2><p className="panel-subtitle">公司管理员只能在自己的公司创建和改名小组</p></div><button type="button" onClick={() => { setError(""); setGroupEditor("new"); }} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white"><Plus size={16} />添加小组</button></div>
      <div className="data-table-wrap"><table className="data-table min-w-[860px]"><thead><tr><th>小组</th><th>国家/时区</th><th>当地时间</th><th>工作状态</th><th>组长</th><th>全部成员</th><th>状态</th><th>操作</th></tr></thead><tbody>{groups.map((group) => <tr key={group.id}><td><strong>{group.name}</strong></td><td>{businessTimezoneOption(group.effectiveTimezone).label}<small className="block text-slate-500">{group.inheritedTimezone ? "继承公司默认" : "小组独立设置"}</small></td><td>{group.localTime}</td><td><strong>{group.label}</strong><small className="block text-slate-500">10:00–22:00</small></td><td>{group.leadCount}</td><td>{group.memberCount}</td><td><span className={`inline-flex items-center gap-2 ${group.active ? "text-blue-700" : "text-slate-500"}`}>{group.active ? <CheckCircle size={17} weight="fill" /> : <Circle size={17} />}{group.active ? "启用" : "停用"}</span></td><td><button type="button" onClick={() => { setError(""); setGroupEditor(group); }} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700"><PencilSimple size={15} />编辑</button></td></tr>)}{!groups.length ? <tr><td colSpan={8} className="empty-state">还没有小组，请先创建第一个小组</td></tr> : null}</tbody></table></div>
    </section>

    {!isDepartmentManager ? <section className="panel overflow-hidden"><div className="panel-header"><div><h2 className="panel-title">部门管理员账号</h2><p className="panel-subtitle">例如美国市场、德国市场；账号只能查看对应市场部门</p></div><button type="button" disabled={!countryOptions.length} onClick={() => { setError(""); setDepartmentManagerOpen(true); }} className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16} />添加部门管理员</button></div><div className="data-table-wrap"><table className="data-table min-w-[680px]"><thead><tr><th>部门</th><th>管理员</th><th>账号</th><th>市场</th><th>状态</th><th>最近登录</th></tr></thead><tbody>{departmentManagers.map((manager) => <tr key={manager.id}><td><strong>{manager.managementScopeName}</strong></td><td>{manager.name}</td><td>{manager.username}</td><td>{manager.managementCountryCode ? countryLabel(manager.managementCountryCode) : "未设置"}</td><td>{manager.active ? "启用" : "停用"}</td><td>{lastLogin(manager.lastLoginAt)}</td></tr>)}{!departmentManagers.length ? <tr><td colSpan={6} className="empty-state">还没有部门管理员账号</td></tr> : null}</tbody></table></div></section> : null}

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">本公司人员调动</h2><p className="panel-subtitle">可在本公司小组之间调岗、调组；旧客户和旧业绩保留在原小组</p></div></div>
      <div className="data-table-wrap"><table className="data-table min-w-[760px]"><thead><tr><th>成员</th><th>人员代号</th><th>当前小组</th><th>当前岗位</th><th>操作</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong></td><td>{member.employeeCode ?? member.username}</td><td>{member.group?.name ?? "未分组"}</td><td>{member.role === "LEAD" ? "组长" : member.role === "RECEPTION" ? "接粉" : member.role === "GROUP_OPERATOR" ? "炒群" : "专家"}</td><td><button type="button" onClick={() => { setError(""); setTransferMember(member); }} className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700"><ArrowsLeftRight size={15} />办理调动</button></td></tr>)}{!members.length ? <tr><td colSpan={5} className="empty-state">本公司还没有可调动的一线成员</td></tr> : null}</tbody></table></div>
    </section>

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">组长账号</h2><p className="panel-subtitle">一个小组同时只能有一位启用中的组长</p></div><button type="button" disabled={!activeGroups.length} onClick={() => { setError(""); setLeadEditor("new"); }} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} />添加组长</button></div>
      <div className="data-table-wrap"><table className="data-table min-w-[820px]"><thead><tr><th>组长</th><th>账号</th><th>所属小组</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><strong>{lead.name}</strong></td><td>{lead.username}</td><td>{lead.group?.name ?? "未分组"}</td><td><span className={`inline-flex items-center gap-2 ${lead.active ? "text-blue-700" : "text-slate-500"}`}>{lead.active ? <CheckCircle size={17} weight="fill" /> : <Circle size={17} />}{lead.active ? "启用" : "停用"}</span></td><td>{lastLogin(lead.lastLoginAt)}</td><td><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setError(""); setLeadEditor(lead); }} className="text-sm font-semibold text-blue-700">编辑</button><button type="button" onClick={() => { setError(""); setResetLead(lead); }} className="text-sm font-semibold text-slate-600">重置密码</button><button type="button" onClick={() => requestStatus(lead)} className={`text-sm font-semibold ${lead.active ? "text-red-700" : "text-emerald-700"}`}>{lead.active ? "停用" : "启用"}</button></div></td></tr>)}{!leads.length ? <tr><td colSpan={6} className="empty-state">还没有组长账号</td></tr> : null}</tbody></table></div>
    </section>

    {groupEditor ? <div className="fixed inset-0 z-50 bg-slate-950/35" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && setGroupEditor(null)}><aside role="dialog" aria-modal="true" aria-label={selectedGroup ? "编辑小组" : "添加小组"} className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-6 py-5"><h2 className="text-xl font-bold">{selectedGroup ? "编辑小组" : "添加小组"}</h2><button type="button" aria-label="关闭" onClick={() => setGroupEditor(null)} className="rounded p-2 text-slate-500"><X size={20} /></button></header><form onSubmit={saveGroup} className="flex flex-1 flex-col"><div className="flex-1 space-y-5 p-6"><label className="block text-sm font-semibold">小组名称<input name="name" defaultValue={selectedGroup?.name} required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="block text-sm font-semibold">国家和时区<select name="timezone" defaultValue={selectedGroup?.timezone ?? ""} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="">继承公司默认（{businessTimezoneOption(companyTimezone).label}）</option>{BUSINESS_TIMEZONE_OPTIONS.map((option) => <option key={option.timezone} value={option.timezone}>{option.label}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">每天按当地时间 10:00–22:00 工作</span></label>{error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}</div><footer className="border-t p-6"><button disabled={busy} className="w-full rounded-md bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "确认保存"}</button></footer></form></aside></div> : null}

    {leadEditor ? <div className="fixed inset-0 z-50 bg-slate-950/35" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && setLeadEditor(null)}><aside role="dialog" aria-modal="true" aria-label={selectedLead ? "编辑组长账号" : "添加组长账号"} className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-6 py-5"><h2 className="text-xl font-bold">{selectedLead ? "编辑组长账号" : "添加组长账号"}</h2><button type="button" aria-label="关闭" onClick={() => setLeadEditor(null)} className="rounded p-2 text-slate-500"><X size={20} /></button></header><form onSubmit={saveLead} className="flex flex-1 flex-col"><div className="flex-1 space-y-5 overflow-y-auto p-6"><label className="block text-sm font-semibold">姓名<input name="name" defaultValue={selectedLead?.name} required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="block text-sm font-semibold">登录账号<input name="username" defaultValue={selectedLead?.username} required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /></label>{!selectedLead ? <label className="block text-sm font-semibold">初始密码<input name="password" type="password" minLength={12} required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-500">至少12位，组长首次登录后必须修改</span></label> : null}<label className="block text-sm font-semibold">所属小组<select name="groupId" defaultValue={selectedLead?.groupId ?? activeGroups[0]?.id} required className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 font-normal">{groups.filter((group) => group.active || group.id === selectedLead?.groupId).map((group) => <option key={group.id} value={group.id}>{group.name}{group.active ? "" : "（已停用）"}</option>)}</select></label>{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}</div><footer className="border-t p-6"><button disabled={busy} className="w-full rounded-md bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : selectedLead ? "保存修改" : "创建组长账号"}</button></footer></form></aside></div> : null}

    {resetLead ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation"><form onSubmit={savePassword} role="dialog" aria-modal="true" aria-label="重置组长密码" className="w-full max-w-md rounded-xl bg-white shadow-2xl"><header className="border-b px-5 py-4"><h2 className="text-lg font-bold">重置“{resetLead.name}”的密码</h2><p className="mt-1 text-sm text-slate-600">保存后，该组长现有登录会全部退出，首次登录必须修改密码。</p></header><div className="p-5"><label className="block text-sm font-semibold">新临时密码<input name="password" type="password" minLength={12} required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /></label>{error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}</div><footer className="flex justify-end gap-2 border-t px-5 py-4"><button type="button" disabled={busy} onClick={() => setResetLead(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold">取消</button><button disabled={busy} className="rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white">确认重置</button></footer></form></div> : null}
    {departmentManagerOpen ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation"><form onSubmit={createDepartmentManager} role="dialog" aria-modal="true" aria-label="添加部门管理员" className="w-full max-w-lg rounded-xl bg-white shadow-2xl"><header className="border-b px-6 py-5"><h2 className="text-xl font-bold">添加部门管理员</h2><p className="mt-1 text-sm text-slate-600">账号只能看到所选市场国家下的小组、员工、客户和统计。</p></header><div className="grid gap-4 p-6 sm:grid-cols-2"><label className="text-sm font-semibold">部门名称<input name="managementScopeName" required maxLength={60} placeholder="例如：美国市场" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="text-sm font-semibold">市场国家<select name="managementCountryCode" required className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 font-normal">{countryOptions.map((code) => <option key={code} value={code}>{countryLabel(code)}</option>)}</select></label><label className="text-sm font-semibold">管理员姓名<input name="name" required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="text-sm font-semibold">登录账号<input name="username" required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="text-sm font-semibold sm:col-span-2">临时密码<input name="password" type="password" minLength={12} required className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-500">至少 12 位，首次登录必须修改</span></label>{error ? <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}</div><footer className="flex justify-end gap-2 border-t px-6 py-4"><button type="button" disabled={busy} onClick={() => setDepartmentManagerOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold">取消</button><button disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "创建中…" : "确认创建"}</button></footer></form></div> : null}
    {transferMember ? <MemberTransferDialog member={transferMember} members={members} groups={groups} businessDate={businessDate} onClose={() => setTransferMember(null)} onSave={transfer} /> : null}
    <WorkflowConfirmationDialog confirmation={confirmation} busy={busy} error={confirmation ? error : ""} onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }} />
  </main>;
}
