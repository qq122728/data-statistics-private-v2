import type { Role, User } from "@prisma/client";
import { db } from "./db";
import { notificationWriteRoles } from "./permissions";
import { managedDepartmentIds } from "./managed-department-scope";

export const notificationSenderRoles = notificationWriteRoles;
export const notificationTargetRoles = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
export type NotificationSenderRole = (typeof notificationSenderRoles)[number];
export type NotificationTargetRole = (typeof notificationTargetRoles)[number];
export type NotificationTargetType = "ALL" | "GROUP" | "ROLE" | "USERS";

type Actor = Pick<User, "id" | "role" | "groupId" | "active"> & {
  duty?: User["duty"];
  departmentId?: string | null;
  companyId?: string | null;
  managementCountryCode?: string | null;
  managedDepartments?: Array<{ departmentId: string }>;
  resourceChannelAccess?: Array<{ channelId: string }>;
  roleAssignments?: Array<{ role: Role }>;
};

export function canSendNotifications(actor: Actor): boolean {
  return Boolean(actor.active && (
    actor.role === "ADMIN"
    || actor.role === "RESOURCE_MANAGER"
    || actor.duty === "HQ_MANAGER"
    || actor.duty === "COMPANY_MANAGER"
    || actor.duty === "DEPARTMENT_MANAGER"
    || actor.role === "LEAD"
    || actor.roleAssignments?.some((assignment) => assignment.role === "LEAD")
  ));
}

type NotificationScopeClient = Pick<typeof db, "teamGroup" | "user" | "channel">;

export async function notificationScope(actor: Actor, client: NotificationScopeClient = db) {
  if (!actor.active) return { groups: [], users: [], departments: [] };
  const allGroups = await client.teamGroup.findMany({
    where: { active: true },
    select: { id: true, name: true, departmentId: true, countryCode: true, department: { select: { id: true, name: true, countryCode: true, companyId: true } } },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
  });
  const departmentIds = managedDepartmentIds(actor);
  const assignedResourceChannels = actor.role === "RESOURCE_MANAGER"
    ? await client.channel.findMany({
        where: {
          id: { in: actor.resourceChannelAccess?.map((access) => access.channelId) ?? [] },
          active: true,
          group: { active: true },
        },
        select: { groupId: true },
      })
    : [];
  // 资源账号只能通知其明确授权 channelId 实际覆盖的小组。不能因为渠道类型相同，
  // 就把另一个投流/短信渠道的小组也纳入范围。
  const resourceGroupIds = new Set(assignedResourceChannels.map((channel) => channel.groupId));
  const groups = actor.role === "ADMIN" || actor.duty === "HQ_MANAGER"
    ? allGroups
    : actor.role === "RESOURCE_MANAGER"
      ? allGroups.filter((group) => resourceGroupIds.has(group.id))
    : actor.duty === "COMPANY_MANAGER" && actor.companyId
      ? allGroups.filter((group) => group.department.companyId === actor.companyId)
      : actor.duty === "DEPARTMENT_MANAGER"
        ? allGroups.filter((group) => departmentIds.includes(group.departmentId))
    : actor.role === "COMPANY_MANAGER" && actor.departmentId
      ? allGroups.filter((group) => group.departmentId === actor.departmentId && (!actor.managementCountryCode || (group.countryCode || group.department.countryCode) === actor.managementCountryCode))
      : actor.role === "LEAD" && actor.groupId
        ? allGroups.filter((group) => group.id === actor.groupId)
        : [];
  const groupIds = groups.map((group) => group.id);
  const scopedDepartmentIds = [...new Set(groups.map((group) => group.departmentId))];
  const globalScope = actor.role === "ADMIN" || actor.duty === "HQ_MANAGER";
  const users = globalScope
    ? await client.user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true, groupId: true, departmentId: true, roleAssignments: { select: { role: true } } },
      orderBy: [{ groupId: "asc" }, { role: "asc" }, { name: "asc" }],
    })
    : groupIds.length
      ? await client.user.findMany({
        where: actor.duty === "COMPANY_MANAGER" && actor.companyId
          ? { active: true, OR: [{ groupId: { in: groupIds } }, { departmentId: { in: scopedDepartmentIds } }, { companyId: actor.companyId }] }
          : actor.duty === "DEPARTMENT_MANAGER" || (actor.role === "COMPANY_MANAGER" && actor.departmentId)
            ? { active: true, OR: [{ groupId: { in: groupIds } }, { departmentId: { in: scopedDepartmentIds } }] }
            : { active: true, groupId: { in: groupIds } },
        select: { id: true, name: true, role: true, groupId: true, departmentId: true, roleAssignments: { select: { role: true } } },
        orderBy: [{ groupId: "asc" }, { role: "asc" }, { name: "asc" }],
      })
      : [];
  return {
    groups,
    users,
    departments: actor.role === "ADMIN" || actor.duty === "HQ_MANAGER" || actor.duty === "COMPANY_MANAGER" || actor.duty === "DEPARTMENT_MANAGER"
      ? [...new Map(groups.map((group) => [group.department.id, group.department])).values()]
      : [],
  };
}

export async function unreadNotificationCount(userId: string) {
  // 本地热更新时 Prisma 客户端可能仍是旧版本；铃铛不应因此阻断整个系统。
  const recipientModel = (db as typeof db & { notificationRecipient?: typeof db.notificationRecipient }).notificationRecipient;
  if (!recipientModel) return 0;
  return recipientModel.count({
    where: { userId, readAt: null, notification: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
  });
}
