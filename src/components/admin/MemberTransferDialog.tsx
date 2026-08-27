"use client";

import { X } from "@phosphor-icons/react";
import { FormEvent, useState } from "react";

type TransferRole = "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "HR" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
export type TransferMember = { id: string; employeeCode: string | null; username: string; name: string; role: TransferRole; roleAssignments?: Array<{ role: TransferRole }>; groupId: string | null; active: boolean; group: { id?: string; name: string; active?: boolean } | null };
export type TransferGroup = { id: string; name: string; active: boolean; departmentName?: string };

const roles = [
  { value: "RECEPTION", label: "前台接粉" },
  { value: "GROUP_OPERATOR", label: "前台炒群" },
  { value: "EXPERT", label: "前台专家" },
  { value: "LEAD", label: "组长" },
] as const;

export function MemberTransferDialog({ member, members, groups, businessDate, onClose, onSave }: {
  member: TransferMember;
  members: TransferMember[];
  groups: TransferGroup[];
  businessDate: string;
  onClose: () => void;
  onSave: (body: object) => Promise<void>;
}) {
  const initialRole = roles.some((item) => item.value === member.role) ? member.role as typeof roles[number]["value"] : "RECEPTION";
  const [role, setRole] = useState(initialRole);
  const currentSecondary = member.roleAssignments?.find((assignment) => assignment.role !== member.role)?.role;
  const [secondary, setSecondary] = useState<"RECEPTION" | "GROUP_OPERATOR" | "">(currentSecondary === "RECEPTION" || currentSecondary === "GROUP_OPERATOR" ? currentSecondary : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const oldGroupMembers = members.filter((candidate) => candidate.id !== member.id && candidate.active && candidate.groupId === member.groupId);
  const assignedRoles = (candidate: TransferMember) => new Set([candidate.role, ...(candidate.roleAssignments?.map((item) => item.role) ?? [])]);
  const receptionCandidates = oldGroupMembers.filter((candidate) => assignedRoles(candidate).has("RECEPTION") || assignedRoles(candidate).has("LEAD"));
  const operatorCandidates = oldGroupMembers.filter((candidate) => assignedRoles(candidate).has("GROUP_OPERATOR") || assignedRoles(candidate).has("LEAD"));
  const expertCandidates = oldGroupMembers.filter((candidate) => assignedRoles(candidate).has("EXPERT") || assignedRoles(candidate).has("LEAD"));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await onSave({
        userId: member.id,
        targetGroupId: String(form.get("targetGroupId") ?? ""),
        role,
        secondaryRoles: secondary ? [secondary] : [],
        effectiveOn: String(form.get("effectiveOn") ?? ""),
        reason: String(form.get("reason") ?? ""),
        receptionHandoffId: String(form.get("receptionHandoffId") ?? "") || null,
        operatorHandoffId: String(form.get("operatorHandoffId") ?? "") || null,
        expertHandoffId: String(form.get("expertHandoffId") ?? "") || null,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "办理调动失败");
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[60] bg-slate-950/30" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="办理人员调动" className="absolute left-1/2 top-1/2 flex max-h-[92vh] w-[min(94vw,620px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-start justify-between border-b border-slate-200 px-6 py-5"><div><h2 className="text-xl font-bold text-slate-950">办理人员调动</h2><p className="mt-1 text-sm text-slate-500">{member.employeeCode ?? member.username} · {member.name} · 当前 {member.group?.name ?? "未分组"}</p></div><button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></header>
      <form onSubmit={submit} className="space-y-5 overflow-y-auto px-6 py-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong>客户不会随人调组。</strong>旧客户、旧订单和旧业绩继续归原小组；调动后该成员只操作新小组数据。系统会退出该成员现有登录，并解除旧小组设备绑定。</div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">目标小组<select name="targetGroupId" defaultValue={member.groupId ?? ""} required className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">{groups.filter((group) => group.active).map((group) => <option key={group.id} value={group.id}>{group.departmentName ? `${group.departmentName} / ` : ""}{group.name}</option>)}</select></label><label className="text-sm font-medium text-slate-700">生效日期<input name="effectiveOn" type="date" defaultValue={businessDate} max={businessDate} required className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5" /></label></div>
        <label className="block text-sm font-medium text-slate-700">调动后主岗位<select value={role} onChange={(event) => { setRole(event.target.value as typeof role); setSecondary(""); }} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">{roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {(role === "RECEPTION" || role === "GROUP_OPERATOR") ? <label className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"><input type="checkbox" checked={Boolean(secondary)} onChange={(event) => setSecondary(event.target.checked ? (role === "RECEPTION" ? "GROUP_OPERATOR" : "RECEPTION") : "")} />同时兼任{role === "RECEPTION" ? "前台炒群" : "前台接粉"}</label> : null}
        <fieldset className="rounded-xl border border-slate-200 p-4"><legend className="px-2 text-sm font-semibold text-slate-800">原小组未完成客户转交</legend><p className="mb-3 text-xs leading-5 text-slate-500">只转交尚未进入下一阶段的客户；客户归属、来源小组和已经产生的业绩不会改变。同组仍保留原岗位时，无需选择接收人。</p><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium text-slate-600">接粉接收人<select name="receptionHandoffId" defaultValue="" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"><option value="">没有需要转交</option>{receptionCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label className="text-xs font-medium text-slate-600">炒群接收人<select name="operatorHandoffId" defaultValue="" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"><option value="">没有需要转交</option>{operatorCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label className="text-xs font-medium text-slate-600">专家接收人<select name="expertHandoffId" defaultValue="" className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"><option value="">没有需要转交</option>{expertCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label></div></fieldset>
        <label className="block text-sm font-medium text-slate-700">调动原因<textarea name="reason" minLength={4} maxLength={500} required rows={3} placeholder="例如：8月16日起调至B组负责炒群" className="mt-2 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5" /></label>
        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        <footer className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">取消</button><button type="submit" disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60">{saving ? "正在办理…" : "确认办理调动"}</button></footer>
      </form>
    </section>
  </div>;
}
