import { redirect } from "next/navigation";
import { CompanyOrganizationManager } from "../../../components/company/CompanyOrganizationManager";
import { AuthenticationError, AuthorizationError, requireRole } from "../../../lib/auth";
import { getActiveCompanyScope } from "../../../lib/company-organization";
import { db } from "../../../lib/db";
import { businessWorkStatus, resolveGroupBusinessTime } from "../../../lib/business-time";
import { recordSecurityEvent } from "../../../lib/security-events";
import { localDateYYYYMMDD } from "../../../lib/dates";

export default async function CompanyOrganizationPage() {
  let user;
  try { user = await requireRole("COMPANY_MANAGER"); }
  catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/company-organization");
    if (error instanceof AuthorizationError) {
      recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: error.actor?.id ?? null, teamId: error.actor?.groupId ?? null, result: "denied" });
      redirect("/dashboard");
    }
    throw error;
  }
  const company = await getActiveCompanyScope(user.id);
  if (!company) {
    recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: user.id, teamId: user.groupId, result: "denied" });
    return <main className="page-shell"><div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900"><h1 className="text-xl font-bold">当前公司不可用</h1><p className="mt-2 text-sm">请联系总公司管理员检查公司绑定和启用状态。</p></div></main>;
  }
  const [groupsRaw, leadsRaw, membersRaw, departmentManagersRaw] = await Promise.all([
    db.teamGroup.findMany({ where: { departmentId: company.id, ...(company.managementCountryCode ? { OR: [{ countryCode: company.managementCountryCode }, { countryCode: null, department: { countryCode: company.managementCountryCode } }] } : {}) }, select: { id: true, name: true, active: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, _count: { select: { members: true } }, members: { where: { role: "LEAD", active: true }, select: { id: true } } }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    db.user.findMany({ where: { role: "LEAD", group: { departmentId: company.id, ...(company.managementCountryCode ? { OR: [{ countryCode: company.managementCountryCode }, { countryCode: null, department: { countryCode: company.managementCountryCode } }] } : {}) } }, select: { id: true, username: true, name: true, role: true, groupId: true, active: true, lastLoginAt: true, group: { select: { id: true, name: true, active: true } } }, orderBy: { createdAt: "desc" } }),
    db.user.findMany({
      where: { active: true, role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] }, group: { departmentId: company.id, ...(company.managementCountryCode ? { OR: [{ countryCode: company.managementCountryCode }, { countryCode: null, department: { countryCode: company.managementCountryCode } }] } : {}) } },
      select: { id: true, employeeCode: true, username: true, name: true, role: true, roleAssignments: { select: { role: true } }, groupId: true, active: true, group: { select: { id: true, name: true, active: true } } },
      orderBy: [{ group: { name: "asc" } }, { name: "asc" }],
    }),
    company.managementCountryCode ? Promise.resolve([]) : db.user.findMany({ where: { role: "COMPANY_MANAGER", departmentId: company.id, managementCountryCode: { not: null } }, select: { id: true, username: true, name: true, active: true, managementScopeName: true, managementCountryCode: true, lastLoginAt: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const groups = groupsRaw.map(({ _count, members, ...group }) => {
    const config = resolveGroupBusinessTime({ ...group, department: company });
    return { ...group, effectiveTimezone: config.timezone, effectiveCountryCode: config.countryCode, inheritedTimezone: group.timezone === null, ...businessWorkStatus(config), memberCount: _count.members, leadCount: members.length };
  });
  const leads = leadsRaw.map((lead) => ({ ...lead, lastLoginAt: lead.lastLoginAt?.toISOString() ?? null }));
  return <CompanyOrganizationManager companyName={company.name} companyTimezone={company.timezone} groups={groups} leads={leads} members={membersRaw} departmentManagers={departmentManagersRaw.map((manager) => ({ ...manager, lastLoginAt: manager.lastLoginAt?.toISOString() ?? null }))} businessDate={localDateYYYYMMDD(new Date(), company.timezone)} managementScopeName={company.managementScopeName} managementCountryCode={company.managementCountryCode} />;
}
