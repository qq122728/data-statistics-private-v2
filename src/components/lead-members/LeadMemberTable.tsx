import { CheckCircle, Circle } from "@phosphor-icons/react";

export type LeadMember = {
  id: string;
  username: string;
  name: string;
  role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  roleAssignments?: Array<{ role: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT" }>;
  groupId: string;
  active: boolean;
  lastLoginAt: string | null;
  group: { name: string } | null;
};

function formatLastLogin(lastLoginAt: string | null) {
  if (!lastLoginAt) return "从未登录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(lastLoginAt));
}

const jobName = {
  RECEPTION: "前台接粉",
  GROUP_OPERATOR: "前台炒群",
  EXPERT: "前台专家",
} as const;

function memberRoles(member: LeadMember) {
  return [...new Set([member.role, ...(member.roleAssignments?.map((assignment) => assignment.role) ?? [])])];
}

export function LeadMemberTable({
  members,
  onEdit,
}: {
  members: LeadMember[];
  onEdit: (member: LeadMember) => void;
}) {
  return (
    <div className="overflow-x-auto border border-slate-200 bg-white">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead className="bg-slate-50 text-sm font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">组员</th>
            <th className="px-4 py-3">岗位</th>
            <th className="px-4 py-3">账号</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">最近登录</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {members.map((member) => (
            <tr key={member.id} className="hover:bg-slate-50/70">
              <td className="px-4 py-3.5 font-medium text-slate-950">
                <span className="mr-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
                  {member.name.slice(0, 1)}
                </span>
                {member.name}
              </td>
              <td className="px-4 py-3.5 text-slate-600">
                <div className="flex flex-wrap gap-1.5">
                  {memberRoles(member).map((role) => <span key={role} className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{jobName[role]}</span>)}
                </div>
              </td>
              <td className="px-4 py-3.5 text-slate-600">{member.username}</td>
              <td className="px-4 py-3.5">
                <span
                  className={`inline-flex items-center gap-2 ${member.active ? "text-blue-700" : "text-slate-500"}`}
                >
                  {member.active ? (
                    <CheckCircle size={17} weight="fill" aria-hidden="true" />
                  ) : (
                    <Circle size={17} aria-hidden="true" />
                  )}
                  {member.active ? "启用" : "停用"}
                </span>
              </td>
              <td className="px-4 py-3.5 text-slate-600">
                {formatLastLogin(member.lastLoginAt)}
              </td>
              <td className="px-4 py-3.5 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(member)}
                  className="rounded px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-50"
                >
                  编辑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!members.length && (
        <div className="px-6 py-14 text-center text-sm text-slate-500">
          没有找到符合条件的组员
        </div>
      )}
    </div>
  );
}
