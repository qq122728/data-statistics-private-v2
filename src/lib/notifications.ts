import type { Role, User } from "@prisma/client";
import { db } from "./db";
import { notificationWriteRoles } from "./permissions";

export const notificationSenderRoles = notificationWriteRoles;
export const notificationTargetRoles = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
export type NotificationSenderRole = (typeof notificationSenderRoles)[number];
export type NotificationTargetRole = (typeof notificationTargetRoles)[number];
export type NotificationTargetType = "ALL" | "GROUP" | "ROLE" | "USERS";

type Actor = Pick<User, "id" | "role" | "groupId" | "active"> & { departmentId?: string | null; managementCountryCode?: string | null };

export function canSendNotifications(role: Role): role is NotificationSenderRole {
  return notificationSenderRoles.includes(role as NotificationSenderRole);
}

type NotificationScopeClient = Pick<typeof db, "teamGroup" | "user">;

export async function notificationScope(actor: Actor, client: NotificationScopeClient = db) {
  if (!actor.active) return { groups: [], users: [], departments: [] };
  const allGroups = await client.teamGroup.findMany({
    where: { active: true },
    select: { id: true, name: true, departmentId: true, countryCode: true, department: { select: { id: true, name: true, countryCode: true } } },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
  });
  const groups = actor.role === "ADMIN"
    ? allGroups
    : actor.role === "COMPANY_MANAGER" && actor.departmentId
      ? allGroups.filter((group) => group.departmentId === actor.departmentId && (!actor.managementCountryCode || (group.countryCode || group.department.countryCode) === actor.managementCountryCode))
      : actor.role === "LEAD" && actor.groupId
        ? allGroups.filter((group) => group.id === actor.groupId)
        : [];
  const groupIds = groups.map((group) => group.id);
  const users = groupIds.length
    ? await client.user.findMany({
      where: { active: true, OR: [{ groupId: { in: groupIds } }, ...(actor.role === "ADMIN" || (actor.role === "COMPANY_MANAGER" && !actor.managementCountryCode) ? [{ departmentId: actor.role === "COMPANY_MANAGER" ? actor.departmentId : { not: null } }] : [])] },
      select: { id: true, name: true, role: true, groupId: true, departmentId: true },
      orderBy: [{ groupId: "asc" }, { role: "asc" }, { name: "asc" }],
    })
    : [];
  const allowedUserIds = new Set(users.map((user) => user.id));
  if (actor.role === "ADMIN") {
    const admins = await client.user.findMany({ where: { active: true, role: { in: ["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER"] } }, select: { id: true, name: true, role: true, groupId: true, departmentId: true } });
    for (const user of admins) if (!allowedUserIds.has(user.id)) users.push(user);
  }
  return {
    groups,
    users,
    departments: actor.role === "ADMIN"
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
