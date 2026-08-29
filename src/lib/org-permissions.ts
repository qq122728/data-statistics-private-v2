import type { Duty, Role } from "@prisma/client";
import { hasAssignedRole } from "./role-access";

/**
 * 阶段5a新增的权限网关（需求文档第五章）。只服务阶段5新增的组织架构/组织权限路由，
 * 不接管老53个路由的权限判断，不读 Role 字符串做层级判断（只有 5.1 的 canOperateCustomer
 * 例外——那条规则本来就是按岗位 Role 定义的，跟组织结构层级无关）。
 *
 * 命名坑提醒（/Users/aaaa/.claude/plans/merry-sauteeing-cook.md 阶段5开工前摸底确认）：
 * 老 Role.COMPANY_MANAGER 语义其实是"管一个部门"，对应这里的 Duty.DEPARTMENT_MANAGER
 * （范围字段复用既有的 User.departmentId，不是新字段）。真正"管一个公司下多个部门"的
 * 新公司管理员用 Duty.COMPANY_MANAGER + 阶段5a新增的 User.companyId 表达；
 * Duty.HQ_MANAGER 不需要任何范围字段，命中即放行全局（对齐 Company 模型注释：
 * 总公司本身无限定即超级权限）。
 */

export type OrgPermissionUser = {
  id: string;
  role: Role;
  duty: Duty | null;
  active: boolean;
  groupId: string | null;
  departmentId: string | null;
  companyId: string | null;
  roleAssignments?: Array<{ role: Role }>;
};

// ---------------------------------------------------------------------------
// 5.6 组织结构操作权限
// ---------------------------------------------------------------------------

/** 总公司管理员新建公司（5.6：只有总公司管理员能新建公司）。 */
export function canCreateCompany(user: OrgPermissionUser): boolean {
  return user.active && user.duty === "HQ_MANAGER";
}

/**
 * 总公司管理员新建部门（5.6："另外能新建公司、新建部门"，只在总公司管理员这一行出现，
 * 部门管理员/公司管理员都没有这项权限）。国家/时区是创建时的输入，不是权限判断的依据，
 * 由路由自己校验，这里不强制要求调用方传公司信息。
 */
export function canCreateDepartment(user: OrgPermissionUser): boolean {
  return user.active && user.duty === "HQ_MANAGER";
}

export type DepartmentScope = { id: string; companyId: string | null };

/**
 * 新建小组（5.6）：部门管理员限本部门、公司管理员限本公司名下任意部门、总公司管理员不限。
 * 接受已经解析好的部门范围对象（而不是在函数内部现查库），跟 report-scope.ts/permissions.ts
 * 里 canReadReportGroup 的既有写法一致，保持这一批函数本身是纯函数、不用 mock 数据库就能测。
 */
export function canCreateGroup(user: OrgPermissionUser, department: DepartmentScope): boolean {
  if (!user.active) return false;
  if (user.duty === "HQ_MANAGER") return true;
  if (user.duty === "COMPANY_MANAGER") return Boolean(user.companyId) && department.companyId === user.companyId;
  if (user.duty === "DEPARTMENT_MANAGER") return Boolean(user.departmentId) && department.id === user.departmentId;
  return false;
}

export type GroupScope = { id: string; departmentId: string; companyId: string | null };

/**
 * 任免/调动组长（5.6）：部门管理员限本部门小组、公司管理员限本公司名下小组、总公司管理员不限。
 * 与 canCreateGroup 是同一套三层判断，只是目标从"部门"换成"小组"，两者故意保持相同结构，
 * 方便以后同时维护。
 *
 * 只表达"对目标小组有没有权限"这一条规则（计划文档给出的原始定义）。调用方（新路由）如果
 * 涉及跨组调动，需要对调出的原小组和调入的目标小组各调用一次本函数，两边都通过才可以放行——
 * 这条对称检查是路由层的职责，不是这个函数本身要表达的规则，保持这个函数只做"一个目标够不够权限"
 * 这一个判断。
 */
export function canAppointOrTransferLead(user: OrgPermissionUser, targetGroup: GroupScope): boolean {
  if (!user.active) return false;
  if (user.duty === "HQ_MANAGER") return true;
  if (user.duty === "COMPANY_MANAGER") return Boolean(user.companyId) && targetGroup.companyId === user.companyId;
  if (user.duty === "DEPARTMENT_MANAGER") return Boolean(user.departmentId) && targetGroup.departmentId === user.departmentId;
  return false;
}

// ---------------------------------------------------------------------------
// 5.2 能看到哪些数据（这里只覆盖组织结构树的可见范围，即阶段5a读取端点要用的那部分；
// 客户记录/报表本身的可见范围仍然是 report-scope.ts/permissions.ts 的职责，不重复）
// ---------------------------------------------------------------------------

export type OrgScopeTarget =
  | { level: "group"; groupId: string; departmentId: string; companyId: string | null }
  | { level: "department"; departmentId: string; companyId: string | null }
  | { level: "company"; companyId: string };

/**
 * 组长看本组、部门管理员看本部门（不含公司层视图）、公司管理员看本公司（跨部门）、
 * 总公司管理员看全部——对应5.2表格里"组织结构"这几档。一线岗位/资源部/财务不适用这张表，
 * 各自的可见范围是另一套规则（报表范围、渠道范围等），不归这个函数管，统一返回 false。
 */
export function canViewOrgScope(user: OrgPermissionUser, scope: OrgScopeTarget): boolean {
  if (!user.active) return false;
  if (user.duty === "HQ_MANAGER") return true;
  if (user.duty === "COMPANY_MANAGER") {
    return Boolean(user.companyId) && scope.companyId === user.companyId;
  }
  if (user.duty === "DEPARTMENT_MANAGER") {
    if (scope.level === "company") return false;
    return Boolean(user.departmentId) && scope.departmentId === user.departmentId;
  }
  if (hasAssignedRole(user, "LEAD")) {
    if (scope.level !== "group") return false;
    return Boolean(user.groupId) && scope.groupId === user.groupId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5.1 能操作哪些客户
// ---------------------------------------------------------------------------

export type CustomerOperationTarget = {
  batch: { groupId: string };
  ownerId: string | null;
  groupOperatorOwnerId: string | null;
  expertOwnerId: string | null;
};

/**
 * 5.1 客户操作范围表的直接翻译：接粉只能动自己名下的、炒群只能动分给自己的、专家只能动
 * 明确分配给自己的、组长本组全权；资源部/财务/各级管理员一律不能操作客户，只读。
 * 用 hasAssignedRole 而不是直接比较 user.role，兼容1.4允许的接粉/炒群兼任场景
 * （兼任的人两个岗位对应的客户都能操作，但仍然只能操作分给自己的那些，不是整组）。
 */
export function canOperateCustomer(user: OrgPermissionUser, target: CustomerOperationTarget): boolean {
  if (!user.active) return false;
  if (hasAssignedRole(user, "LEAD")) return Boolean(user.groupId) && target.batch.groupId === user.groupId;
  if (hasAssignedRole(user, "RECEPTION") && target.ownerId === user.id) return true;
  if (hasAssignedRole(user, "GROUP_OPERATOR") && target.groupOperatorOwnerId === user.id) return true;
  if (hasAssignedRole(user, "EXPERT") && target.expertOwnerId === user.id) return true;
  return false;
}
