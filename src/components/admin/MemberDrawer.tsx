"use client";

import { X } from "@phosphor-icons/react";
import { FormEvent, useEffect, useState } from "react";
import { resolveEmployeeStage } from "../../lib/employee-stage";
import { BUSINESS_TIMEZONE_OPTIONS } from "../../lib/business-time-config";
import {
  adminRoleOptions,
  type AdminDepartment,
  type AdminGroup,
  type AdminMember,
  type EmployeeStage,
  type RecruitmentSource,
  type ResourceChannelOption,
} from "./MemberTable";
import { classifyAdminFormError, employeeStageNames, type AdminFormError } from "./admin-display";
import { HighRiskConfirmationDialog } from "./HighRiskConfirmationDialog";
import { getMemberHighRiskOperation } from "./admin-high-risk";

type Role = AdminMember["role"];
type ResourceChannelType = ResourceChannelOption["channelType"];
type SaveBody = { employeeCode: string; username: string; name: string; password?: string; role: Role; secondaryRoles: Array<"RECEPTION" | "GROUP_OPERATOR">; resourceChannelIds: string[]; groupId: string | null; departmentId: string | null; managementScopeName: string | null; managementCountryCode: string | null; hireDate: string | null; recruitmentSource: RecruitmentSource | null; referrerName: string | null; stageOverride: EmployeeStage | null; stageOverrideReason: string | null };
type PendingHighRiskAction =
  | { kind: "admin-privilege" | "admin-access-revocation"; submitWith: "save"; body: SaveBody }
  | { kind: "admin-password-reset"; submitWith: "action"; body: { password: string } }
  | { kind: "admin-access-revocation" | "admin-reactivation"; submitWith: "action"; body: { active: boolean } };
type StageContext = { businessDate: string; trainingDays: number; observationDays: number };
const historyRoleNames: Record<string, string> = { LEAD: "组长", RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家" };
const resourceChannelTypeNames: Record<ResourceChannelType, string> = { SMS: "短信粉", ADS: "投流粉", REBATE: "底料返点" };
const countryNames = new Map<string, string>(BUSINESS_TIMEZONE_OPTIONS.map((option) => [option.countryCode, option.countryLabel]));

function selectedResourceChannelTypes(member: AdminMember | null, channels: ResourceChannelOption[]): ResourceChannelType[] {
  const assignedIds = new Set(member?.resourceChannelAccess?.map((access) => access.channelId) ?? []);
  return [...new Set(channels.filter((channel) => assignedIds.has(channel.id)).map((channel) => channel.channelType))];
}

export function MemberDrawer({ member, groups, departments, resourceChannels, stageContext, onClose, onSave, onAction }: {
  member: AdminMember | null; groups: AdminGroup[]; departments: AdminDepartment[]; onClose: () => void;
  resourceChannels: ResourceChannelOption[];
  stageContext: StageContext;
  onSave: (body: SaveBody) => Promise<void>; onAction: (body: object) => Promise<void>;
}) {
  const [role, setRole] = useState<Role>(member?.role ?? "RECEPTION");
  const [secondaryRole, setSecondaryRole] = useState<"RECEPTION" | "GROUP_OPERATOR" | "">("");
  const [resourceChannelTypes, setResourceChannelTypes] = useState<ResourceChannelType[]>(() => selectedResourceChannelTypes(member, resourceChannels));
  const [hireDate, setHireDate] = useState(member?.hireDate ?? "");
  const [recruitmentSource, setRecruitmentSource] = useState<RecruitmentSource | "">(member?.recruitmentSource ?? "");
  const [stageOverride, setStageOverride] = useState<EmployeeStage | "">(member?.stageOverride ?? "");
  const [managerLevel, setManagerLevel] = useState<"COMPANY" | "DEPARTMENT">(member?.managementCountryCode ? "DEPARTMENT" : "COMPANY");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(member?.departmentId ?? "");
  const [saving, setSaving] = useState(false); const [error, setError] = useState<AdminFormError | null>(null);
  const [resetOpen, setResetOpen] = useState(false); const [confirmStatus, setConfirmStatus] = useState(false);
  const [pendingHighRiskAction, setPendingHighRiskAction] = useState<PendingHighRiskAction | null>(null);
  useEffect(() => { setRole(member?.role ?? "RECEPTION"); const assigned = member?.roleAssignments?.find((assignment) => assignment.role !== member.role)?.role; setSecondaryRole(assigned === "RECEPTION" || assigned === "GROUP_OPERATOR" ? assigned : ""); setResourceChannelTypes(selectedResourceChannelTypes(member, resourceChannels)); setHireDate(member?.hireDate ?? ""); setRecruitmentSource(member?.recruitmentSource ?? ""); setStageOverride(member?.stageOverride ?? ""); setManagerLevel(member?.managementCountryCode ? "DEPARTMENT" : "COMPANY"); setSelectedDepartmentId(member?.departmentId ?? ""); setError(null); setResetOpen(false); setConfirmStatus(false); setPendingHighRiskAction(null); }, [member, resourceChannels]);
  const activeGroups = groups.filter((group) => group.active || group.id === member?.groupId);
  const automaticStage = resolveEmployeeStage({ onDate: stageContext.businessDate, hireDate: hireDate || null, override: null, trainingDays: stageContext.trainingDays, observationDays: stageContext.observationDays });
  const managerCountryOptions = [...new Set(groups.filter((group) => group.active && group.departmentId === selectedDepartmentId).map((group) => group.effectiveCountryCode).filter((code): code is string => Boolean(code)))];
  const pendingSaveBody = pendingHighRiskAction?.submitWith === "save"
    ? pendingHighRiskAction.body
    : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const unscopedRole = role === "ADMIN" || role === "RESOURCE_MANAGER" || role === "FINANCE" || role === "HR";
    const departmentId = role === "COMPANY_MANAGER" ? String(form.get("departmentId") ?? "") || null : null;
    const body: SaveBody = { employeeCode: String(form.get("employeeCode") ?? member?.employeeCode ?? member?.username ?? ""), username: String(form.get("username") ?? ""), name: String(form.get("name") ?? ""), password: member ? undefined : String(form.get("password") ?? ""), role, secondaryRoles: secondaryRole ? [secondaryRole] : [], resourceChannelIds: role === "RESOURCE_MANAGER" ? [...new Set(resourceChannels.filter((channel) => resourceChannelTypes.includes(channel.channelType)).map((channel) => channel.id))] : [], groupId: member ? member.groupId : role === "COMPANY_MANAGER" || unscopedRole ? null : String(form.get("groupId") ?? "") || null, departmentId, managementScopeName: role === "COMPANY_MANAGER" && managerLevel === "DEPARTMENT" ? String(form.get("managementScopeName") ?? "") || null : null, managementCountryCode: role === "COMPANY_MANAGER" && managerLevel === "DEPARTMENT" ? String(form.get("managementCountryCode") ?? "") || null : null, hireDate: hireDate || null, recruitmentSource: recruitmentSource || null, referrerName: recruitmentSource === "AGENT" ? String(form.get("referrerName") ?? "") || null : null, stageOverride: stageOverride || null, stageOverrideReason: stageOverride ? String(form.get("stageOverrideReason") ?? "") || null : null };
    const highRiskOperation = getMemberHighRiskOperation({
      previousRole: member?.role ?? null,
      nextRole: role,
      previousActive: member?.active ?? null,
      nextActive: member?.active ?? true,
      hasNewPassword: Boolean(body.password),
    });
    if (
      highRiskOperation === "admin-privilege" ||
      highRiskOperation === "admin-access-revocation"
    ) {
      setPendingHighRiskAction({
        kind: highRiskOperation,
        submitWith: "save",
        body,
      });
      return;
    }
    setSaving(true);
    try { await onSave(body); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "保存失败"; setError(classifyAdminFormError("member", message)); }
    finally { setSaving(false); }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); const form = new FormData(event.currentTarget);
    const body = { password: String(form.get("temporaryPassword") ?? "") };
    const highRiskOperation = getMemberHighRiskOperation({
      previousRole: member?.role ?? null,
      nextRole: member?.role ?? role,
      previousActive: member?.active ?? null,
      nextActive: member?.active ?? true,
      hasNewPassword: true,
    });
    if (highRiskOperation === "admin-password-reset") {
      setPendingHighRiskAction({
        kind: highRiskOperation,
        submitWith: "action",
        body,
      });
      return;
    }
    setSaving(true);
    try { await onAction(body); setResetOpen(false); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "重置失败"; setError(classifyAdminFormError("member", message)); }
    finally { setSaving(false); }
  }

  async function changeStatus() {
    setSaving(true); setError(null);
    try { await onAction({ active: !member?.active }); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "操作失败"; setError(classifyAdminFormError("member", message)); setConfirmStatus(false); }
    finally { setSaving(false); }
  }

  function requestStatusChange() {
    const nextActive = !member?.active;
    const highRiskOperation = getMemberHighRiskOperation({
      previousRole: member?.role ?? null,
      nextRole: member?.role ?? role,
      previousActive: member?.active ?? null,
      nextActive,
      hasNewPassword: false,
    });
    if (
      highRiskOperation === "admin-access-revocation" ||
      highRiskOperation === "admin-reactivation"
    ) {
      setError(null);
      setPendingHighRiskAction({
        kind: highRiskOperation,
        submitWith: "action",
        body: { active: nextActive },
      });
      return;
    }
    setConfirmStatus(true);
  }

  return <div className="fixed inset-0 z-50 bg-slate-950/20" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside role="dialog" aria-modal="true" aria-label={member ? "编辑成员" : "添加成员"} className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><h2 className="text-xl font-bold text-slate-950">{member ? "编辑成员" : "添加成员"}</h2><button type="button" onClick={onClose} aria-label="关闭" className="rounded p-2 text-slate-500 hover:bg-slate-100"><X size={20} aria-hidden="true" /></button></header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <form id="member-form" onSubmit={submit} className="space-y-5">
          <label className="block text-sm font-medium text-slate-700">人员代号<input name="employeeCode" defaultValue={member?.employeeCode ?? member?.username} required readOnly={Boolean(member)} minLength={2} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]+" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 font-mono uppercase outline-none read-only:bg-slate-100 read-only:text-slate-500 focus:border-blue-600" /><span className="mt-1 block text-sm font-normal text-slate-500">唯一且永久不变，用于调岗、调组后合并同一人的数据。</span></label>
          <label className="block text-sm font-medium text-slate-700">姓名<input name="name" defaultValue={member?.name} required aria-invalid={error?.field === "name"} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600" />{error?.field === "name" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>
          <label className="block text-sm font-medium text-slate-700">登录账号<input name="username" defaultValue={member?.username} required aria-invalid={error?.field === "username"} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600" />{error?.field === "username" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>
          {!member && <label className="block text-sm font-medium text-slate-700">初始密码<input name="password" type="password" minLength={12} required aria-invalid={error?.field === "password"} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-600" /><span className="mt-1 block text-sm font-normal text-slate-500">至少 12 位，成员首次登录后必须修改</span>{error?.field === "password" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>}
          <label className="block text-sm font-medium text-slate-700">角色<select name="role" value={role} disabled={Boolean(member)} onChange={(event) => { setRole(event.target.value as Role); setSecondaryRole(""); }} aria-invalid={error?.field === "role"} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 disabled:bg-slate-100 disabled:text-slate-500">{adminRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{member ? <span className="mt-1 block text-sm font-normal text-amber-700">岗位变化请关闭本窗口后使用“办理调动”，系统会保留历史岗位。</span> : null}{error?.field === "role" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>
          {(role === "RECEPTION" || role === "GROUP_OPERATOR") && <label className="block rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-slate-700"><span className="font-medium">兼任岗位</span><span className="ml-2 text-slate-500">一个账号可同时使用两个工作台。</span><span className="mt-2 flex items-center gap-2"><input type="checkbox" disabled={Boolean(member)} checked={Boolean(secondaryRole)} onChange={(event) => setSecondaryRole(event.target.checked ? (role === "RECEPTION" ? "GROUP_OPERATOR" : "RECEPTION") : "")} />同时兼任{role === "RECEPTION" ? "前台炒群" : "前台接粉"}</span>{member ? <span className="mt-1 block text-amber-700">兼任岗位变化也请使用“办理调动”，避免覆盖历史岗位。</span> : null}</label>}
          {role === "RESOURCE_MANAGER" ? <fieldset className="rounded-lg border border-cyan-200 bg-cyan-50 p-3"><legend className="px-1 text-sm font-semibold text-cyan-950">可查看渠道类型（至少选择一个）</legend><p className="mb-2 text-xs leading-5 text-cyan-800">按业务类型授权。选择“投流粉”后，该账号可查看现在及以后新增的全部投流渠道；服务端会强制隔离其他类型。</p><div className="grid gap-2 sm:grid-cols-2">{(["SMS", "ADS", "REBATE"] as ResourceChannelType[]).filter((channelType) => resourceChannels.some((channel) => channel.channelType === channelType)).map((channelType) => { const count = new Set(resourceChannels.filter((channel) => channel.channelType === channelType).map((channel) => channel.id)).size; return <label key={channelType} className="flex items-center gap-2 rounded-md border border-cyan-100 bg-white px-3 py-3 text-sm"><input type="checkbox" checked={resourceChannelTypes.includes(channelType)} onChange={(event) => setResourceChannelTypes((current) => event.target.checked ? [...new Set([...current, channelType])] : current.filter((type) => type !== channelType))} /><span className="font-semibold text-slate-800">{resourceChannelTypeNames[channelType]}</span><small className="ml-auto text-slate-400">{count} 个渠道</small></label>; })}</div>{!resourceChannels.length ? <p className="text-sm text-amber-700">请先在渠道管理中创建渠道。</p> : null}</fieldset> : null}
          {role === "COMPANY_MANAGER" ? <section className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4"><label className="block text-sm font-medium text-slate-700">管理级别<select value={managerLevel} onChange={(event) => setManagerLevel(event.target.value as "COMPANY" | "DEPARTMENT")} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"><option value="COMPANY">公司管理员（整家公司）</option><option value="DEPARTMENT">部门管理员（指定市场）</option></select></label><label className="block text-sm font-medium text-slate-700">所属下属公司<select name="departmentId" value={selectedDepartmentId} onChange={(event) => setSelectedDepartmentId(event.target.value)} required aria-invalid={error?.field === "departmentId"} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"><option value="">请选择下属公司</option>{departments.filter((department) => department.active || department.id === member?.departmentId).map((department) => <option key={department.id} value={department.id}>{department.name}{!department.active ? "（已停用）" : ""}</option>)}</select></label>{managerLevel === "DEPARTMENT" ? <><label className="block text-sm font-medium text-slate-700">部门名称<input name="managementScopeName" defaultValue={member?.managementScopeName ?? ""} required maxLength={60} placeholder="例如：美国市场" className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5" /></label><label className="block text-sm font-medium text-slate-700">市场国家<select name="managementCountryCode" defaultValue={member?.managementCountryCode ?? ""} required className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"><option value="">请选择市场</option>{managerCountryOptions.map((code) => <option key={code} value={code}>{countryNames.get(code) ?? code}</option>)}</select></label><p className="text-sm leading-6 text-indigo-800">该账号只能看到所选市场的小组、员工、客户和统计。修改后旧登录会立即退出。</p></> : <p className="text-sm leading-6 text-indigo-800">该账号可以查看和管理这家公司下的全部市场。</p>}{error?.field === "departmentId" && <span role="alert" className="block text-sm text-red-700">{error.message}</span>}</section> : <label className="block text-sm font-medium text-slate-700">所属小组<select name="groupId" defaultValue={member?.groupId ?? ""} disabled={Boolean(member)} required={role !== "ADMIN" && role !== "RESOURCE_MANAGER" && role !== "FINANCE" && role !== "HR"} aria-invalid={error?.field === "groupId"} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 disabled:bg-slate-100 disabled:text-slate-500">{(role === "ADMIN" || role === "RESOURCE_MANAGER" || role === "FINANCE" || role === "HR") && <option value="">未分组（跨公司查看）</option>}{activeGroups.map((group) => <option key={group.id} value={group.id}>{group.departmentName ? `${group.departmentName} / ` : ""}{group.name}{!group.active ? "（已停用）" : ""}</option>)}</select><span className="mt-1 block text-sm font-normal text-slate-500">{member ? "调组请使用“办理调动”，旧客户和旧业绩不会被搬走。" : role === "LEAD" ? "一个小组只能设置一位启用中的组长" : role === "RESOURCE_MANAGER" ? "资源部管理员不绑定小组，但只显示上方已授权渠道的数据" : role === "FINANCE" ? "财务不绑定小组，可查看全公司考勤并导出考勤和业绩报表" : role === "HR" ? "行政不绑定公司或小组，只能查看人员档案与考勤" : role === "ADMIN" ? "系统管理员不绑定公司或小组" : "一线岗位必须归属一个启用中的小组"}</span>{error?.field === "groupId" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>}
          {member?.membershipHistory?.length ? <section className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3"><h3 className="text-sm font-semibold text-slate-800">调动履历</h3><ul className="mt-2 space-y-2 text-sm text-slate-600">{member.membershipHistory.map((entry) => <li key={entry.id}><span className="font-medium text-slate-800">{entry.group.name}</span> · {[entry.role, ...(entry.secondaryRoles?.split(",").filter(Boolean) ?? [])].map((item) => historyRoleNames[item] ?? item).join("＋")}<span className="block text-xs text-slate-500">{entry.effectiveFrom} 至 {entry.effectiveTo ?? "现在"}</span>{entry.reason ? <span className="block text-xs text-slate-500">{entry.reason}</span> : null}</li>)}</ul></section> : null}
          <label className="block text-sm font-medium text-slate-700">入职日期<input name="hireDate" type="date" value={hireDate} onChange={(event) => setHireDate(event.target.value)} aria-invalid={error?.field === "hireDate"} className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5" />{error?.field === "hireDate" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>
          <label className="block text-sm font-medium text-slate-700">入职来源<select name="recruitmentSource" value={recruitmentSource} onChange={(event) => setRecruitmentSource(event.target.value as RecruitmentSource | "")} aria-invalid={error?.field === "recruitmentSource"} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"><option value="">待补（由财务补充）</option><option value="DIRECT">公司直营</option><option value="AGENT">代理介绍</option></select><span className="mt-1 block text-sm font-normal text-slate-500">旧员工可先留“待补”；新员工请按实际来源填写。</span>{error?.field === "recruitmentSource" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>
          {recruitmentSource === "AGENT" && <label className="block text-sm font-medium text-slate-700">介绍人<input name="referrerName" defaultValue={member?.referrerName ?? ""} required maxLength={60} aria-invalid={error?.field === "referrerName"} placeholder="填写介绍人姓名或代号" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5" />{error?.field === "referrerName" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>}
          <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"><span className="font-medium">自动阶段预览：{employeeStageNames[automaticStage.stage]}</span><span className="ml-2 text-sky-700">{automaticStage.employmentDay === null ? "未填入职日期，按培训阶段显示" : `入职第 ${automaticStage.employmentDay} 天`}</span><p className="mt-1 text-sky-700">按业务日期 {stageContext.businessDate} 计算。</p></div>
          <label className="block text-sm font-medium text-slate-700">手动阶段<select name="stageOverride" value={stageOverride} onChange={(event) => setStageOverride(event.target.value as EmployeeStage | "")} aria-invalid={error?.field === "stageOverride"} className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2.5"><option value="">使用自动阶段</option>{Object.entries(employeeStageNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{error?.field === "stageOverride" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>
          {stageOverride && <label className="block text-sm font-medium text-slate-700">覆盖原因<textarea name="stageOverrideReason" defaultValue={member?.stageOverrideReason ?? ""} required minLength={4} aria-invalid={error?.field === "stageOverrideReason"} className="mt-2 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2.5" /><span className="mt-1 block text-sm font-normal text-slate-500">至少 4 个字，会连同前后阶段写入操作日志。</span>{error?.field === "stageOverrideReason" && <span role="alert" className="mt-1 block text-sm font-normal text-red-700">{error.message}</span>}</label>}
        </form>
        {member && <div className="mt-8 space-y-3 border-t border-slate-200 pt-6">
          {!resetOpen ? <button type="button" onClick={() => { setResetOpen(true); setError(null); }} className="w-full rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium">重置密码</button> : <form onSubmit={resetPassword} className="rounded-md border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-medium text-amber-900">输入至少 12 位的新临时密码。保存后，该成员现有登录会全部退出，首次登录必须修改密码。</p><input aria-label="新临时密码" name="temporaryPassword" type="password" minLength={12} required aria-invalid={error?.field === "password"} className="mt-3 w-full rounded border border-amber-300 bg-white px-3 py-2" />{error?.field === "password" && <p role="alert" className="mt-1 text-sm text-red-700">{error.message}</p>}<div className="mt-3 flex gap-2"><button disabled={saving} className="rounded bg-amber-700 px-3 py-2 text-sm text-white">确认重置</button><button type="button" onClick={() => { setResetOpen(false); setError(null); }} className="text-sm text-slate-600">取消</button></div></form>}
          {!confirmStatus ? <button type="button" onClick={requestStatusChange} className={`w-full rounded-md border px-4 py-2.5 text-sm font-medium ${member.active ? "border-red-300 text-red-700" : "border-emerald-300 text-emerald-700"}`}>{member.active ? "停用账号" : "重新启用账号"}</button> : <div className={`rounded-md border p-4 ${member.active ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}><p className={`text-sm ${member.active ? "text-red-800" : "text-emerald-800"}`}>确认{member.active ? "停用" : "重新启用"}“{member.name}”的账号？</p><div className="mt-3 flex gap-2"><button type="button" disabled={saving} onClick={changeStatus} className={`rounded px-3 py-2 text-sm text-white disabled:opacity-60 ${member.active ? "bg-red-600" : "bg-emerald-600"}`}>确认操作</button><button type="button" disabled={saving} onClick={() => setConfirmStatus(false)} className="text-sm text-slate-600 disabled:opacity-60">取消</button></div></div>}
        </div>}
        {error && !error.field && <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}
      </div>
      <footer className="border-t border-slate-200 p-6"><button form="member-form" disabled={saving} className="w-full rounded-md bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "保存中…" : member ? "保存修改" : "添加成员"}</button></footer>
    </aside>
    <HighRiskConfirmationDialog
      open={Boolean(pendingHighRiskAction)}
      title={pendingHighRiskAction?.kind === "admin-password-reset"
        ? "确认重置管理员密码"
        : pendingHighRiskAction?.kind === "admin-reactivation"
          ? "确认重新启用管理员账号"
          : pendingHighRiskAction?.kind === "admin-access-revocation"
            ? pendingHighRiskAction.submitWith === "action"
              ? "确认停用管理员账号"
              : "确认撤销管理员权限"
        : member ? "确认授予管理员权限" : "确认创建管理员账号"}
      description={pendingHighRiskAction?.kind === "admin-password-reset"
        ? `正在重置管理员“${member?.name ?? ""}”的密码。保存后，该管理员现有登录会全部退出，并可使用新密码重新登录管理后台。`
        : pendingHighRiskAction?.kind === "admin-reactivation"
          ? `重新启用管理员“${member?.name ?? ""}”后，该账号会恢复全系统管理权限，并可重新登录管理后台。`
          : pendingHighRiskAction?.kind === "admin-access-revocation"
            ? pendingHighRiskAction.submitWith === "action"
              ? `停用管理员“${member?.name ?? ""}”后，该账号将无法登录，现有登录会全部退出。`
              : `“${member?.name ?? ""}”将失去全系统管理权限，现有登录会全部退出。请确认这是经过批准的权限调整。`
        : member
          ? `“${pendingSaveBody?.name ?? member.name}”将获得全系统管理权限，可以管理成员、组织、渠道和系统设置。请确认这是经过批准的授权。`
          : `将创建管理员“${pendingSaveBody?.name ?? ""}”，该账号会获得全系统管理权限。请确认创建目的和授权范围。`}
      confirmLabel={pendingHighRiskAction?.kind === "admin-password-reset"
        ? "确认重置管理员密码"
        : pendingHighRiskAction?.kind === "admin-reactivation"
          ? "确认重新启用管理员账号"
          : pendingHighRiskAction?.kind === "admin-access-revocation"
            ? pendingHighRiskAction.submitWith === "action"
              ? "确认停用管理员账号"
              : "确认撤销管理员权限"
        : member ? "确认授权并保存" : "确认创建管理员"}
      onClose={() => setPendingHighRiskAction(null)}
      onConfirm={async (credentials) => {
        if (!pendingHighRiskAction) return;
        if (pendingHighRiskAction.submitWith === "action") {
          await onAction({ ...pendingHighRiskAction.body, ...credentials });
          return;
        }
        await onSave({ ...pendingHighRiskAction.body, ...credentials });
      }}
    />
  </div>;
}
