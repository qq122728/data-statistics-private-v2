import { redirect } from "next/navigation";
import { AuthenticationError, AuthorizationError, requireRole } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { PersonnelDirectory } from "../../../components/personnel/PersonnelDirectory";
import { recordSecurityEvent } from "../../../lib/security-events";

/** 行政专用花名册：只允许补充入职资料，不提供岗位、账号、组织或业务数据修改。 */
export default async function PersonnelPage() {
  try { await requireRole("HR"); }
  catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/personnel");
    if (error instanceof AuthorizationError) {
      recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: error.actor?.id ?? null, teamId: error.actor?.groupId ?? null, result: "denied" });
      redirect("/dashboard");
    }
    throw error;
  }
  const members = await db.user.findMany({
    select: {
      id: true, name: true, username: true, role: true, active: true, hireDate: true, recruitmentSource: true, referrerName: true,
      department: { select: { name: true } },
      group: { select: { name: true, department: { select: { name: true } } } },
    },
    orderBy: [{ active: "desc" }, { group: { department: { name: "asc" } } }, { group: { name: "asc" } }, { name: "asc" }],
  });
  return <main className="page-shell workflow-wide-page space-y-3">
    <div className="page-heading"><div><h1 className="page-title">人员档案</h1><p className="page-description">行政可补充入职日期和人员归属（公司直营／代理介绍及介绍人）；不能改岗位、账号、公司小组、业务数据或系统设置。</p></div></div>
    <PersonnelDirectory initialMembers={members.map((member) => ({ id: member.id, name: member.name, username: member.username, role: member.role, active: member.active, hireDate: member.hireDate, recruitmentSource: member.recruitmentSource, referrerName: member.referrerName, departmentName: member.department?.name ?? null, groupName: member.group ? `${member.group.department.name} / ${member.group.name}` : null }))} />
  </main>;
}
