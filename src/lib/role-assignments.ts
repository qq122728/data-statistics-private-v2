import type { Role } from "@prisma/client";

const reciprocalFrontlineRole: Partial<Record<Role, Role>> = {
  RECEPTION: "GROUP_OPERATOR",
  GROUP_OPERATOR: "RECEPTION",
};

export type SecondaryRoleParseResult =
  | { success: true; value: Role[] }
  | { success: false; error: string };

/** 兼任仅开放接粉与炒群的一对一组合，避免本次意外放开专家或管理权限。 */
export function parseFrontlineSecondaryRoles(
  primaryRole: Role,
  value: unknown,
): SecondaryRoleParseResult {
  if (value === undefined) return { success: true, value: [] };
  if (!Array.isArray(value) || value.length > 1 || value.some((role) => typeof role !== "string"))
    return { success: false, error: "兼任岗位参数不正确" };

  const roles = [...new Set(value)] as Role[];
  if (roles.length === 0) return { success: true, value: [] };
  const allowedRole = reciprocalFrontlineRole[primaryRole];
  if (roles.length !== 1 || !allowedRole || roles[0] !== allowedRole) {
    const primaryName = primaryRole === "RECEPTION" ? "接粉" : primaryRole === "GROUP_OPERATOR" ? "炒群" : "当前";
    const allowedName = allowedRole === "RECEPTION" ? "前台接粉" : "前台炒群";
    return { success: false, error: `${primaryName}账号只能兼任${allowedName}` };
  }
  return { success: true, value: roles };
}
