import { Prisma, type Role } from "@prisma/client";
import { db } from "./db";
import { hasAssignedRole } from "./role-access";
export {
  customerWorkflowRoles,
  customerDeleteRoles,
  customerOrderWriteRoles,
  expertCustomerPageRoles,
  groupCustomerPageRoles,
  hasAnyRole,
  hasManagementAccess,
  hasAssignedRole,
  managementRoles,
  roleIsOneOf,
} from "./role-access";

export type PermissionUser = {
  id: string;
  role: Role;
  groupId: string | null;
  departmentId?: string | null;
  managementCountryCode?: string | null;
  active: boolean;
  resourceChannelAccess?: Array<{ channelId: string }>;
};

/**
 * 写操作共用的岗位白名单。页面可以据此决定是否展示入口；路由在真正写入前
 * 还必须调用 findLivePermissionUser，避免旧登录状态绕过刚发生的停用/调岗。
 */
export const attendanceWriteRoles = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
export const notificationWriteRoles = ["ADMIN", "COMPANY_MANAGER", "LEAD"] as const;
export const deviceAccountWriteRoles = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
export const adminWriteRoles = ["ADMIN"] as const;
export const channelManagementWriteRoles = ["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER"] as const;

type PermissionClient = Pick<typeof db, "user"> | Prisma.TransactionClient;

export async function findLivePermissionUser(
  client: PermissionClient,
  userId: string,
): Promise<PermissionUser | null> {
  return client.user.findFirst({
    where: { id: userId, active: true },
    select: { id: true, role: true, groupId: true, departmentId: true, managementCountryCode: true, active: true },
  });
}

export function canWriteAttendance(user: PermissionUser): boolean {
  return user.active && Boolean(user.groupId) && attendanceWriteRoles.some((role) => hasAssignedRole(user, role));
}

export function canWriteNotifications(user: PermissionUser): boolean {
  return user.active && notificationWriteRoles.includes(user.role as (typeof notificationWriteRoles)[number]);
}

export function canWriteDeviceAccounts(user: PermissionUser): boolean {
  return user.active && Boolean(user.groupId) && deviceAccountWriteRoles.some((role) => hasAssignedRole(user, role));
}

export function canWriteAdminSettings(user: PermissionUser): boolean {
  return user.active && adminWriteRoles.includes(user.role as (typeof adminWriteRoles)[number]);
}

export function canWriteChannelManagement(user: PermissionUser): boolean {
  return user.active && channelManagementWriteRoles.includes(user.role as (typeof channelManagementWriteRoles)[number]);
}

export type ReportReadableGroup = {
  id: string;
  departmentId?: string | null;
  countryCode?: string | null;
  department?: { countryCode?: string | null };
};

/**
 * 开单、续充、出金共用同一条“资金写入”边界：组长只能处理本组，
 * 专家只能处理明确分配给自己的客户。不要在每个路由再各写一遍。
 */
export type CustomerRevenueWriteTarget = {
  batch: { groupId: string };
  lead: { expertOwnerId: string | null } | null;
};

export function canWriteCustomerRevenue(
  user: PermissionUser,
  target: CustomerRevenueWriteTarget,
): boolean {
  if (!user.active) return false;
  if (user.role === "LEAD") return Boolean(user.groupId && target.batch.groupId === user.groupId);
  if (user.role === "EXPERT") return target.lead?.expertOwnerId === user.id;
  return false;
}

/**
 * 报表/分析的公司边界。客户编辑和资金写入还会叠加“是否本人负责”的更细规则，
 * 但所有跨小组的读取都应先经过这里，避免不同页面各写一套公司范围。
 */
export function canReadReportGroup(user: PermissionUser, group: ReportReadableGroup): boolean {
  if (!user.active) return false;
  if (user.role === "ADMIN" || user.role === "RESOURCE_MANAGER" || user.role === "FINANCE") return true;
  if (user.role === "COMPANY_MANAGER") {
    if (!user.departmentId || group.departmentId !== user.departmentId) return false;
    return !user.managementCountryCode || (group.countryCode || group.department?.countryCode) === user.managementCountryCode;
  }
  return Boolean(user.groupId && group.id === user.groupId);
}

export function canReadGroup(user: PermissionUser, groupId: string): boolean {
  if (!user.active) {
    return false;
  }

  return user.role === "ADMIN" || (user.role === "LEAD" && user.groupId === groupId);
}

export function canReadEvent(
  user: PermissionUser,
  enteredById: string,
  groupId?: string,
): boolean {
  if (!user.active) {
    return false;
  }

  return (
    user.role === "ADMIN" ||
    (user.role === "LEAD" && user.groupId === groupId) ||
    (user.role === "RECEPTION" && user.id === enteredById)
  );
}

export async function canWriteBatch(
  user: PermissionUser,
  batchId: string,
): Promise<boolean> {
  if (!user.active) {
    return false;
  }

  if (user.role === "ADMIN") {
    return true;
  }

  if ((user.role !== "RECEPTION" && user.role !== "LEAD") || !user.groupId) {
    return false;
  }

  const batch = await db.sourceBatch.findUnique({
    where: { id: batchId },
    select: { groupId: true },
  });

  return batch?.groupId === user.groupId;
}
