import type { Duty, Role } from "@prisma/client";

export type WorkspaceKind = "FRONTLINE" | "ADMIN";

export function workspaceForUser(user: { role: Role; duty: Duty | null }): WorkspaceKind {
  // 新版清爽工作台承接三级组织管理员。
  if (["DEPARTMENT_MANAGER", "COMPANY_MANAGER", "HQ_MANAGER"].includes(user.duty ?? "")) return "FRONTLINE";
  if (["RESOURCE_MANAGER", "FINANCE", "HR"].includes(user.role)) return "FRONTLINE";
  if (user.duty || ["ADMIN", "COMPANY_MANAGER", "LEAD"].includes(user.role)) {
    return "ADMIN";
  }
  return "FRONTLINE";
}
