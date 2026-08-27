import { CheckCircle, Circle } from "@phosphor-icons/react";
import { employeeStageNames } from "./admin-display";

export type AdminGroup = { id: string; name: string; active: boolean; departmentId?: string; departmentName?: string; effectiveCountryCode?: string; department?: { name: string } };
export type AdminDepartment = { id: string; name: string; active: boolean };
export type EmployeeStage = keyof typeof employeeStageNames;
export type RecruitmentSource = "DIRECT" | "AGENT";
export type ResourceChannelOption = { id: string; name: string; active: boolean; channelType: "SMS" | "ADS" | "REBATE" };
export type AdminMember = { id: string; employeeCode: string | null; username: string; name: string; role: "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "HR" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT"; roleAssignments?: Array<{ role: "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "HR" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT" }>; resourceChannelAccess?: Array<{ channelId: string }>; membershipHistory?: Array<{ id: string; groupId: string; role: AdminMember["role"]; secondaryRoles: string | null; effectiveFrom: string; effectiveTo: string | null; reason: string | null; group: { name: string } }>; groupId: string | null; departmentId: string | null; managementScopeName: string | null; managementCountryCode: string | null; active: boolean; hireDate: string | null; recruitmentSource: RecruitmentSource | null; referrerName: string | null; stageOverride: EmployeeStage | null; stageOverrideReason: string | null; stageOverrideAt: string | null; stage: EmployeeStage; employmentDay: number | null; stageSource: "AUTO" | "OVERRIDE"; lastLoginAt: string | null; group: AdminGroup | null; department: AdminDepartment | null };

export const adminRoleOptions: Array<{
  value: AdminMember["role"];
  label: string;
}> = [
  { value: "RECEPTION", label: "前台接粉" },
  { value: "GROUP_OPERATOR", label: "前台炒群" },
  { value: "EXPERT", label: "前台专家" },
  { value: "LEAD", label: "组长" },
  { value: "RESOURCE_MANAGER", label: "资源部管理员（按短信／投流类型）" },
  { value: "COMPANY_MANAGER", label: "公司管理员（仅本公司）" },
  { value: "FINANCE", label: "财务（考勤与业绩导出）" },
  { value: "HR", label: "行政（仅人员档案与考勤）" },
  { value: "ADMIN", label: "管理员" },
];

const roleText = { ADMIN: "管理员", RESOURCE_MANAGER: "资源部管理员", COMPANY_MANAGER: "公司管理员", FINANCE: "财务", HR: "行政", LEAD: "组长", RECEPTION: "前台接粉", GROUP_OPERATOR: "前台炒群", EXPERT: "前台专家" };
const roleStyle = { ADMIN: "bg-blue-50 text-blue-700", RESOURCE_MANAGER: "bg-cyan-50 text-cyan-700", COMPANY_MANAGER: "bg-indigo-50 text-indigo-700", FINANCE: "bg-teal-50 text-teal-700", HR: "bg-rose-50 text-rose-700", LEAD: "bg-emerald-50 text-emerald-700", RECEPTION: "bg-slate-100 text-slate-600", GROUP_OPERATOR: "bg-amber-50 text-amber-700", EXPERT: "bg-violet-50 text-violet-700" };
const stageStyle: Record<EmployeeStage, string> = { TRAINING: "bg-sky-50 text-sky-700", OBSERVATION: "bg-amber-50 text-amber-800", FORMAL: "bg-emerald-50 text-emerald-700", PAUSED: "bg-slate-200 text-slate-700" };

export function MemberTable({ members, onEdit, onTransfer }: { members: AdminMember[]; onEdit: (member: AdminMember) => void; onTransfer: (member: AdminMember) => void }) {
  return <div className="overflow-x-auto border border-slate-200 bg-white">
    <table className="w-full min-w-[940px] text-left text-sm">
      <thead className="bg-slate-50 text-sm font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">成员</th><th className="px-4 py-3">人员代号</th><th className="px-4 py-3">账号</th><th className="px-4 py-3">小组</th><th className="px-4 py-3">角色</th><th className="px-4 py-3">员工阶段</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">最近登录</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
      <tbody className="divide-y divide-slate-200">{members.map((member) => <tr key={member.id} className="hover:bg-slate-50/70">
        <td className="px-4 py-3.5 font-medium text-slate-950"><span className="mr-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{member.name.slice(0, 1)}</span>{member.name}</td>
        <td className="px-4 py-3.5 font-mono font-semibold text-slate-700">{member.employeeCode ?? member.username}</td><td className="px-4 py-3.5 text-slate-600">{member.username}</td><td className="px-4 py-3.5 text-slate-600">{member.department ? member.managementCountryCode ? `${member.department.name} / ${member.managementScopeName ?? member.managementCountryCode}` : `${member.department.name}（公司范围）` : member.group ? `${member.group.department?.name ? `${member.group.department.name} / ` : ""}${member.group.name}` : "未分组"}</td>
        <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1">{[...new Set([member.role, ...(member.roleAssignments?.map((assignment) => assignment.role) ?? [])])].map((role) => <span key={role} className={`rounded px-2 py-1 text-sm font-medium ${roleStyle[role]}`}>{role === "COMPANY_MANAGER" && member.managementCountryCode ? "部门管理员" : roleText[role]}</span>)}</div></td>
        <td className="px-4 py-3.5"><span className={`rounded px-2 py-1 text-sm font-medium ${stageStyle[member.stage]}`}>{employeeStageNames[member.stage]}</span>{member.stageSource === "OVERRIDE" && <span className="ml-1 text-xs text-slate-400">手动</span>}</td>
        <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-2 ${member.active ? "text-blue-700" : "text-slate-500"}`}>{member.active ? <CheckCircle size={17} weight="fill" aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}{member.active ? "启用" : "停用"}</span></td>
        <td className="px-4 py-3.5 text-slate-600">{member.lastLoginAt ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(member.lastLoginAt)) : "从未登录"}</td>
        <td className="px-4 py-3.5 text-right"><div className="flex justify-end gap-1"><button type="button" onClick={() => onEdit(member)} className="rounded px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-50">编辑</button>{member.groupId && ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(member.role) ? <button type="button" onClick={() => onTransfer(member)} className="rounded px-3 py-1.5 font-medium text-amber-700 hover:bg-amber-50">办理调动</button> : null}</div></td>
      </tr>)}</tbody>
    </table>
    {!members.length && <div className="px-6 py-14 text-center text-sm text-slate-500">没有找到符合条件的成员</div>}
  </div>;
}
