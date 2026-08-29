import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppHeader } from "../../components/shell/AppHeader";
import { AppSidebar } from "../../components/shell/AppSidebar";
import { AuthenticationError, PasswordChangeRequiredError, requireUser } from "../../lib/auth";
import { db } from "../../lib/db";
import { getSystemSettings } from "../../lib/settings";
import { resolveUserBusinessTimezone } from "../../lib/business-time";
import { unreadNotificationCount } from "../../lib/notifications";
import { getAssignedRoles } from "../../lib/role-access";

const roleNames = {
  ADMIN: "管理员",
  RESOURCE_MANAGER: "资源部管理员",
  COMPANY_MANAGER: "公司管理员",
  FINANCE: "财务",
  HR: "行政",
  LEAD: "组长",
  RECEPTION: "前台接粉",
  GROUP_OPERATOR: "前台炒群",
  EXPERT: "前台专家",
} as const;
export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof PasswordChangeRequiredError) redirect("/change-password");
    if (error instanceof AuthenticationError) redirect("/login");
    throw error;
  }

  const [group, department, managedCompany, settings, unreadNotifications] = await Promise.all([
    user.groupId
      ? db.teamGroup.findUnique({
          where: { id: user.groupId },
          select: { name: true },
        })
      : Promise.resolve(null),
    user.departmentId
      ? db.department.findUnique({ where: { id: user.departmentId }, select: { name: true } })
      : Promise.resolve(null),
    user.companyId
      ? db.company.findUnique({ where: { id: user.companyId }, select: { name: true } })
      : Promise.resolve(null),
    getSystemSettings(),
    unreadNotificationCount(user.id),
  ]);

  const roles = getAssignedRoles(user);
  const orgDutyLabel = user.duty === "HQ_MANAGER" ? "总公司管理员" : user.duty === "COMPANY_MANAGER" ? "公司管理员" : user.duty === "DEPARTMENT_MANAGER" ? "部门管理员" : null;
  const role = orgDutyLabel ?? roles.map((item) => roleNames[item]).join(" / ");
  const organizationName = user.managementScopeName ?? group?.name ?? department?.name ?? managedCompany?.name;
  const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
  return (
    <div className="app-shell">
      <AppSidebar
        appName={settings.appName}
        user={{
          name: user.name,
          role: user.role,
          roles,
          roleLabel: role,
          groupName: organizationName,
          departmentManager: user.duty === "DEPARTMENT_MANAGER" || (user.role === "COMPANY_MANAGER" && Boolean(user.managementCountryCode)),
        }}
      />
      <AppHeader
        appName={settings.appName}
        userName={user.name}
        role={user.role}
        roleLabel={role}
        groupName={organizationName}
        timezone={timezone}
        unreadNotifications={unreadNotifications}
      />
      <div className="app-content">{children}</div>
    </div>
  );
}
