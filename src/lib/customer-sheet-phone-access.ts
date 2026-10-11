import type { PermissionUser } from "./permissions";

/** Full numbers stay within the customer's group, except for top-level administrators. */
export function canViewFullSheetPhone(
  actor: Pick<PermissionUser, "active" | "role" | "duty" | "groupId">,
  groupId: string,
): boolean {
  return actor.active && (
    actor.role === "ADMIN"
    || actor.duty === "HQ_MANAGER"
    || actor.groupId === groupId
  );
}
