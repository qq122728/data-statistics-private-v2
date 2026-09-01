import type { Role } from "@prisma/client";

export type RoleAccessUser = {
  role: Role;
  active: boolean;
  roleAssignments?: Array<{ role: Role }>;
};

// 财务是只读管理角色：可看公司、小组和成员汇总，但不会取得客户流程写入权限。
export const managementRoles = ["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER", "FINANCE", "LEAD"] as const satisfies readonly Role[];
export const customerWorkflowRoles = ["RECEPTION", "LEAD", "GROUP_OPERATOR", "EXPERT"] as const satisfies readonly Role[];
// 新前线账号只有“组员”一种使用模型。下面的旧 Role 值只用于兼容历史数据、
// 操作日志和旧页面，不再决定组员能不能填每日数据或资金。
export const frontlineMemberRoles = ["RECEPTION", "GROUP_OPERATOR", "EXPERT", "LEAD"] as const satisfies readonly Role[];
// 管理层可以查看明细，但写入权限仍由页面和 API 单独判断，避免只读账号误改一线记录。
export const groupCustomerPageRoles = ["ADMIN", "COMPANY_MANAGER", "LEAD", "GROUP_OPERATOR"] as const satisfies readonly Role[];
export const expertCustomerPageRoles = ["ADMIN", "COMPANY_MANAGER", "LEAD", "EXPERT"] as const satisfies readonly Role[];
export const customerDeleteRoles = ["RECEPTION", "LEAD"] as const satisfies readonly Role[];
// 开单和资金属于专家阶段：组长默认兼任专家，普通组员必须额外开通 EXPERT。
export const customerOrderWriteRoles = ["LEAD", "EXPERT"] as const satisfies readonly Role[];

export function roleIsOneOf(role: Role, roles: readonly Role[]): boolean {
  return roles.includes(role);
}

export function hasAnyRole(user: RoleAccessUser, roles: readonly Role[]): boolean {
  return user.active && getAssignedRoles(user).some((role) => roleIsOneOf(role, roles));
}

/**
 * 返回账号当前能使用的岗位。role 是历史兼容的主岗位，roleAssignments 只放额外岗位；
 * 组长按业务规则默认兼任本组专家，不需要再额外创建一条专家授权。
 * 最后统一去重，避免菜单和权限出现两次同一岗位。
 */
export function getAssignedRoles(user: RoleAccessUser): Role[] {
  const roles = new Set([user.role, ...(user.roleAssignments?.map((assignment) => assignment.role) ?? [])]);
  if (roles.has("LEAD")) roles.add("EXPERT");
  return [...roles];
}

export function hasAssignedRole(user: RoleAccessUser, role: Role): boolean {
  return user.active && getAssignedRoles(user).includes(role);
}

export function hasManagementAccess(user: RoleAccessUser): boolean {
  return hasAnyRole(user, managementRoles);
}

export function isFrontlineGroupMember(user: RoleAccessUser & { groupId: string | null }): boolean {
  return Boolean(user.groupId) && hasAnyRole(user, frontlineMemberRoles);
}
