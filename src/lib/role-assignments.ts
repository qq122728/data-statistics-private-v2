import type { Role } from "@prisma/client";

const frontlineRoles = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const satisfies readonly Role[];

export type SecondaryRoleParseResult =
  | { success: true; value: Role[] }
  | { success: false; error: string };

/**
 * 一线账号可以同时承担接粉、炒群、专家中的任意组合。
 * 主岗位仍用于人员列表和默认打开身份，其余岗位作为可切换的工作权限。
 */
export function parseFrontlineSecondaryRoles(
  primaryRole: Role,
  value: unknown,
): SecondaryRoleParseResult {
  if (value === undefined) return { success: true, value: [] };
  if (!Array.isArray(value) || value.length > 2 || value.some((role) => typeof role !== "string"))
    return { success: false, error: "兼任岗位参数不正确" };

  const roles = [...new Set(value)] as Role[];
  if (roles.length === 0) return { success: true, value: [] };
  if (!frontlineRoles.includes(primaryRole as (typeof frontlineRoles)[number]))
    return { success: false, error: "只有一线账号可以设置兼任岗位" };
  if (roles.length !== value.length || roles.includes(primaryRole) || roles.some((role) => !frontlineRoles.includes(role as (typeof frontlineRoles)[number])))
    return { success: false, error: "兼任岗位只能选择主岗位以外的接粉、炒群或专家，且不能重复" };
  return { success: true, value: roles };
}

/**
 * 黑客组的一般组员默认同时承担接粉与炒群。
 * 专家仍可单独创建；用户额外选择的专家兼任也会保留。
 */
export function applyHackerGroupDefaultRoles(
  primaryRole: Role,
  secondaryRoles: Role[],
  groupType: "HACKER" | "LAWYER" | null | undefined,
): Role[] {
  if (groupType !== "HACKER") return secondaryRoles;
  if (primaryRole !== "RECEPTION" && primaryRole !== "GROUP_OPERATOR") return secondaryRoles;
  const counterpart: Role = primaryRole === "RECEPTION" ? "GROUP_OPERATOR" : "RECEPTION";
  return secondaryRoles.includes(counterpart) ? secondaryRoles : [counterpart, ...secondaryRoles];
}
