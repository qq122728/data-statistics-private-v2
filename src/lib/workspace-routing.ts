import type { Duty, Role } from "@prisma/client";

export type WorkspaceKind = "FRONTLINE" | "ADMIN";

export function workspaceForUser(user: { role: Role; duty: Duty | null }): WorkspaceKind {
  if (user.duty || ["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER", "FINANCE", "HR", "LEAD"].includes(user.role)) {
    return "ADMIN";
  }
  return "FRONTLINE";
}
