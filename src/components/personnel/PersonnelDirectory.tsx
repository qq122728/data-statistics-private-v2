"use client";

import { FloppyDisk, PencilSimple, X } from "@phosphor-icons/react";
import { useState } from "react";

type RecruitmentSource = "DIRECT" | "AGENT" | null;
export type PersonnelMember = {
  id: string;
  name: string;
  username: string;
  role: string;
  active: boolean;
  hireDate: string | null;
  recruitmentSource: RecruitmentSource;
  referrerName: string | null;
  departmentName: string | null;
  groupName: string | null;
};

const roleLabels: Record<string, string> = {
  ADMIN: "管理员", RESOURCE_MANAGER: "资源部管理员", COMPANY_MANAGER: "公司管理员", FINANCE: "财务", HR: "行政",
  LEAD: "组长", RECEPTION: "前台接粉", GROUP_OPERATOR: "前台炒群", EXPERT: "前台专家",
};

function attribution(member: PersonnelMember) {
  if (!member.recruitmentSource) return "待补";
  return member.recruitmentSource === "DIRECT" ? "公司直营" : `代理介绍${member.referrerName ? ` / ${member.referrerName}` : "（待填介绍人）"}`;
}

export function PersonnelDirectory({ initialMembers }: { initialMembers: PersonnelMember[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hireDate, setHireDate] = useState("");
  const [source, setSource] = useState<Exclude<RecruitmentSource, null> | "">("");
  const [referrerName, setReferrerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = members.filter((member) => member.active).length;
  const pending = members.filter((member) => member.active && !member.recruitmentSource).length;
  const editing = members.find((member) => member.id === editingId) ?? null;

  function startEdit(member: PersonnelMember) {
    setEditingId(member.id);
    setHireDate(member.hireDate ?? "");
    setSource(member.recruitmentSource ?? "");
    setReferrerName(member.referrerName ?? "");
    setError("");
  }

  async function save() {
    if (!editing || (source === "AGENT" && !referrerName.trim())) {
      setError("代理介绍请填写介绍人");
      return;
    }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/finance/employment-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, hireDate: hireDate || null, recruitmentSource: source || null, referrerName: source === "AGENT" ? referrerName.trim() : null }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; member?: { hireDate: string | null; recruitmentSource: RecruitmentSource; referrerName: string | null } };
      if (!response.ok || !body.member) throw new Error(body.error ?? "保存人员归属失败");
      setMembers((current) => current.map((member) => member.id === editing.id ? { ...member, hireDate: body.member!.hireDate, recruitmentSource: body.member!.recruitmentSource, referrerName: body.member!.referrerName } : member));
      setEditingId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存人员归属失败");
    } finally { setSaving(false); }
  }

  return <>
    <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3"><Stat label="人员总数" value={members.length} /><Stat label="启用中" value={active} /><Stat label="人员归属待补" value={pending} tone={pending ? "amber" : undefined} /></section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h2 className="m-0 text-base font-bold text-slate-900">全体人员</h2><p className="mb-0 mt-1 text-xs text-slate-500">行政可补充入职日期和人员归属；不能改岗位、账号、公司小组或启用状态。</p></div><div className="data-table-wrap"><table className="data-table min-w-[1080px]"><thead><tr><th>姓名</th><th>登录账号</th><th>归属公司 / 小组</th><th>岗位</th><th>入职日期</th><th>人员归属</th><th>状态</th><th>操作</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td className="font-semibold text-slate-900">{member.name}</td><td>{member.username}</td><td>{member.departmentName ?? (member.groupName ?? "未分组")}</td><td>{roleLabels[member.role] ?? member.role}</td><td>{member.hireDate ?? "待补"}</td><td>{attribution(member)}</td><td><span className={member.active ? "font-semibold text-emerald-700" : "text-slate-500"}>{member.active ? "启用" : "停用"}</span></td><td><button type="button" onClick={() => startEdit(member)} className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"><PencilSimple size={15} weight="bold" />补充资料</button></td></tr>)}{!members.length ? <tr><td colSpan={8} className="empty-state">暂无人员资料</td></tr> : null}</tbody></table></div></section>
    {editing ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4"><section role="dialog" aria-modal="true" aria-labelledby="personnel-attribution-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-3"><div><h2 id="personnel-attribution-title" className="m-0 text-lg font-bold text-slate-900">补充人员资料</h2><p className="mb-0 mt-1 text-sm text-slate-500">{editing.name} · {editing.username}</p></div><button type="button" onClick={() => setEditingId(null)} disabled={saving} aria-label="关闭" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} weight="bold" /></button></div><div className="mt-5 space-y-4"><label className="field-label">入职日期<input type="date" value={hireDate} onChange={(event) => setHireDate(event.target.value)} className="control mt-1 w-full" /></label><label className="field-label">归属类型<select value={source} onChange={(event) => setSource(event.target.value as Exclude<RecruitmentSource, null> | "")} className="control mt-1 w-full"><option value="">请选择</option><option value="DIRECT">公司直营</option><option value="AGENT">代理介绍</option></select></label>{source === "AGENT" ? <label className="field-label">介绍人<input value={referrerName} onChange={(event) => setReferrerName(event.target.value)} maxLength={60} className="control mt-1 w-full" placeholder="填写代理或介绍人姓名" /></label> : null}{error ? <p role="alert" className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}<div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingId(null)} disabled={saving} className="report-toolbar-button">取消</button><button type="button" onClick={save} disabled={saving} className="report-toolbar-button report-toolbar-primary"><FloppyDisk size={16} weight="bold" />{saving ? "保存中…" : "保存资料"}</button></div></div></section></div> : null}
  </>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return <div className="border-b border-slate-100 px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="m-0 text-xs text-slate-500">{label}</p><p className={tone ? "mb-0 mt-1 text-xl font-bold text-amber-700" : "mb-0 mt-1 text-xl font-bold text-slate-900"}>{value}</p></div>;
}
