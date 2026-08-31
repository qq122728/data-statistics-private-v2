import type { Duty, Role } from "@prisma/client";
import { hasAssignedRole } from "./role-access";
import { canManageDepartment } from "./managed-department-scope";

/**
 * 阶段5a新增的权限网关（需求文档第五章）。只服务阶段5新增的组织架构/组织权限路由，
 * 不接管老53个路由的权限判断，不读 Role 字符串做层级判断——只有两处明确例外：
 * 5.1 的 canOperateCustomer（那条规则本来就是按岗位 Role 定义的，跟组织结构层级无关）、
 * 以及组织架构账号创建函数（canCreateGroupLeadAccount/
 * canCreateDepartmentManagerAccount/canCreateCompanyManagerAccount/canCreateHqManagerAccount，见下方对应小节——
 * 需要识别 Role.ADMIN 这个没有 Duty 的系统自举角色）。
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
  managedDepartments?: Array<{ departmentId: string }>;
  roleAssignments?: Array<{ role: Role }>;
};

// ---------------------------------------------------------------------------
// 5.6 组织结构操作权限
// ---------------------------------------------------------------------------

/** 总公司管理员新建公司（5.6：只有总公司管理员能新建公司）。 */
export function canCreateCompany(user: OrgPermissionUser): boolean {
  return user.active && (user.role === "ADMIN" || user.duty === "HQ_MANAGER");
}

export type CompanyScope = { id: string };

/**
 * 新建部门：公司管理员只能在自己绑定的公司内创建；总公司管理员和 ADMIN 不限。
 * 目标公司必须由路由先从数据库解析，再传入本纯函数，不能直接相信请求体中的 companyId。
 */
export function canCreateDepartment(user: OrgPermissionUser, company: CompanyScope): boolean {
  if (!user.active) return false;
  if (user.role === "ADMIN" || user.duty === "HQ_MANAGER") return true;
  return user.duty === "COMPANY_MANAGER" && Boolean(user.companyId) && company.id === user.companyId;
}

export type DepartmentScope = { id: string; companyId: string | null };

/**
 * 新建小组（5.6）：部门管理员限本部门、公司管理员限本公司名下任意部门、总公司管理员不限。
 * 接受已经解析好的部门范围对象（而不是在函数内部现查库），跟 report-scope.ts/permissions.ts
 * 里 canReadReportGroup 的既有写法一致，保持这一批函数本身是纯函数、不用 mock 数据库就能测。
 */
export function canCreateGroup(user: OrgPermissionUser, department: DepartmentScope): boolean {
  if (!user.active) return false;
  if (user.role === "ADMIN") return true;
  if (user.duty === "HQ_MANAGER") return true;
  if (user.duty === "COMPANY_MANAGER") return Boolean(user.companyId) && department.companyId === user.companyId;
  if (user.duty === "DEPARTMENT_MANAGER") return canManageDepartment(user, department.id);
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
  if (user.role === "ADMIN") return true;
  if (user.duty === "HQ_MANAGER") return true;
  if (user.duty === "COMPANY_MANAGER") return Boolean(user.companyId) && targetGroup.companyId === user.companyId;
  if (user.duty === "DEPARTMENT_MANAGER") return canManageDepartment(user, targetGroup.departmentId);
  return false;
}

/**
 * 给空缺小组直接开设一名全新的组长账号。组织管理者的范围跟任命/调动现有人完全一致；
 * 额外放行 ADMIN 只用于系统初始化。单独保留这个函数，不把 ADMIN 塞进
 * canAppointOrTransferLead，避免扩大既有“调动现有人”接口的权限范围。
 */
export function canCreateGroupLeadAccount(user: OrgPermissionUser, targetGroup: GroupScope): boolean {
  if (!user.active) return false;
  if (user.role === "ADMIN") return true;
  return canAppointOrTransferLead(user, targetGroup);
}

// ---------------------------------------------------------------------------
// 5.6 补充：创建下一档管理员账号（阶段5a遗留缺口，本次补上）。
//
// 这三个函数需要读 Role（专门检查 `user.role === "ADMIN"`），是本文件"只读 Duty，
// 不读 Role 字符串做层级判断"这条既有约定之外的**第二处**明确例外（第一处是下面
// canOperateCustomer 的 5.1 岗位判断，那条规则本来就是按 Role 定义的）。这里读 Role
// 的原因不一样：ADMIN 是系统既有的超级管理员角色，没有对应的 Duty，纯粹靠 Role 识别；
// 账号创建这件事绕不开"系统怎么自举出第一批管理账号"这个问题，ADMIN 就是那个自举入口，
// 不是把 Role 当层级判断的主线在用，仍然是刻意的窄口子，不是这条既有约定被悄悄放开了。
// ---------------------------------------------------------------------------

/**
 * 新建 Duty.DEPARTMENT_MANAGER 账号，绑定到一个已存在的部门（需求文档5.6："公司管理员
 * ……既能任免部门管理员"）。公司管理员限本公司名下的部门、总公司管理员不限（可越级），
 * ADMIN 系统自举兜底。部门本身是否存在/启用是路由自己的数据校验，这里只判断调用方
 * 对"这个部门"这一条目标有没有权限，跟 canCreateGroup 是同一种"接收已解析范围对象"写法。
 */
export function canCreateDepartmentManagerAccount(user: OrgPermissionUser, department: DepartmentScope): boolean {
  if (!user.active) return false;
  if (user.role === "ADMIN") return true;
  if (user.duty === "HQ_MANAGER") return true;
  if (user.duty === "COMPANY_MANAGER") return Boolean(user.companyId) && department.companyId === user.companyId;
  return false;
}

/**
 * 新建 Duty.COMPANY_MANAGER 账号，绑定到一个已存在的公司。5.6没有给公司管理员这一档
 * 授权创建同档账号的能力——总公司管理员是唯一能做这件事的非ADMIN档位，这不是"越级"
 * （越级指的是跳过中间层直接管更低一档，比如总公司直接任免组长），而是"公司管理员这一档
 * 本身就没有这项权限，只有更高一档才有"，所以不像 canCreateGroup/canAppointOrTransferLead
 * 那样需要按调用方的 companyId 跟目标比对——判断只看调用方是不是 HQ_MANAGER 或 ADMIN，
 * 不需要接收目标公司这个参数（跟 canCreateCompany/canCreateDepartment 已有的
 * "目标参数不影响判断结果就不接收"这条约定一致）。
 */
export function canCreateCompanyManagerAccount(user: OrgPermissionUser): boolean {
  if (!user.active) return false;
  return user.role === "ADMIN" || user.duty === "HQ_MANAGER";
}

/**
 * 新建 Duty.HQ_MANAGER 账号：纯系统自举操作，业务层级里没有比总公司更高的档位能授权这件事
 * ——即便是现任总公司管理员本人，也不能创建另一个总公司管理员账号，跟"谁创建第一个 admin
 * 账号"是同一类问题，只能靠 ADMIN 兜底。刻意不放行任何 Duty（哪怕是 HQ_MANAGER 本人），
 * 否则会退化成"总公司管理员可以无限复制自己的账号"，绕开了系统本该有的唯一自举入口。
 */
export function canCreateHqManagerAccount(user: OrgPermissionUser): boolean {
  return user.active && user.role === "ADMIN";
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
  // ADMIN 的工作台只用这份树选择要开设管理账号的公司/部门，不读取客户数据。
  if (user.role === "ADMIN") return true;
  if (user.duty === "HQ_MANAGER") return true;
  if (user.duty === "COMPANY_MANAGER") {
    return Boolean(user.companyId) && scope.companyId === user.companyId;
  }
  if (user.duty === "DEPARTMENT_MANAGER") {
    if (scope.level === "company") return false;
    return canManageDepartment(user, scope.departmentId);
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
  currentGroupId?: string | null;
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
  const currentGroupId = target.currentGroupId ?? target.batch.groupId;
  if (hasAssignedRole(user, "LEAD")) return Boolean(user.groupId) && currentGroupId === user.groupId;
  if (hasAssignedRole(user, "RECEPTION") && target.ownerId === user.id) return Boolean(user.groupId) && currentGroupId === user.groupId;
  if (hasAssignedRole(user, "GROUP_OPERATOR") && target.groupOperatorOwnerId === user.id) return Boolean(user.groupId) && currentGroupId === user.groupId;
  if (hasAssignedRole(user, "EXPERT") && target.expertOwnerId === user.id) return Boolean(user.groupId) && currentGroupId === user.groupId;
  return false;
}
