import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { canViewOrgScope, type OrgPermissionUser } from "../../../../lib/org-permissions";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireAdminOrOrgManagerRequest } from "../_auth";
import { managedDepartmentIds } from "../../../../lib/managed-department-scope";

type GroupNode = { id: string; name: string; active: boolean; leadId: string | null; leadName: string | null };
type DepartmentNode = { id: string; name: string; active: boolean; countryCode: string; timezone: string; workStartMinutes: number; workEndMinutes: number; companyId: string | null; groups: GroupNode[] };
type CompanyNode = { id: string; name: string; active: boolean; departments: DepartmentNode[] };

const groupSelect = {
  id: true,
  name: true,
  active: true,
  departmentId: true,
  members: { where: { role: "LEAD" as const, active: true }, select: { id: true, name: true }, take: 1 },
};

function toGroupNode(group: { id: string; name: string; active: boolean; members: Array<{ id: string; name: string }> }): GroupNode {
  const lead = group.members[0] ?? null;
  return { id: group.id, name: group.name, active: group.active, leadId: lead?.id ?? null, leadName: lead?.name ?? null };
}

/**
 * 只在拼装返回结果这一步再用 canViewOrgScope 过滤一遍——上面的 Prisma where 已经按
 * actor 的范围精确查过了，理论上不会查出范围外的数据，这里是防御性的第二道闸门
 * （仿照 report-scope.ts 的 resolveReadableReportGroups 用法），万一两处判断以后走漂了
 * 也不会把不该看的组暴露出去。
 */
function filterGroupsInScope(actor: OrgPermissionUser, department: { id: string; companyId: string | null }, groups: GroupNode[]): GroupNode[] {
  return groups.filter((group) => canViewOrgScope(actor, { level: "group", groupId: group.id, departmentId: department.id, companyId: department.companyId }));
}

async function loadDepartmentNode(departmentId: string): Promise<DepartmentNode | null> {
  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, active: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, companyId: true, groups: { select: groupSelect } },
  });
  if (!department) return null;
  return {
    id: department.id,
    name: department.name,
    active: department.active,
    countryCode: department.countryCode,
    timezone: department.timezone,
    workStartMinutes: department.workStartMinutes,
    workEndMinutes: department.workEndMinutes,
    companyId: department.companyId,
    groups: department.groups.map(toGroupNode),
  };
}

async function loadCompanyNode(companyId: string): Promise<CompanyNode | null> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      active: true,
      departments: { select: { id: true, name: true, active: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, companyId: true, groups: { select: groupSelect } } },
    },
  });
  if (!company) return null;
  return {
    id: company.id,
    name: company.name,
    active: company.active,
    departments: company.departments.map((department) => ({
      id: department.id,
      name: department.name,
      active: department.active,
      countryCode: department.countryCode,
      timezone: department.timezone,
      workStartMinutes: department.workStartMinutes,
      workEndMinutes: department.workEndMinutes,
      companyId: department.companyId,
      groups: department.groups.map(toGroupNode),
    })),
  };
}

/**
 * 阶段5a：给公司管理员/总公司管理员/部门管理员用的组织结构只读端点（公司→部门→小组的
 * drill-down 树），阶段5b的组织管理UI要在这个基础上做前端，这里先把数据形状定下来。
 *
 * 需求文档5.5：跨时区/跨公司一律并排列出，不合并成一个总数——这里直接体现在返回形状上：
 * 总公司管理员拿到的是 companies 数组（每个公司独立一项），不是一个合并对象；
 * 公司管理员/部门管理员各自只能拿到自己那一档，天然不存在"合并"的问题。
 */
export async function GET() {
  const access = await requireAdminOrOrgManagerRequest();
  if ("response" in access) return access.response;
  const actor = access.actor;

  if (actor.role === "ADMIN" || actor.duty === "HQ_MANAGER") {
    const [companies, unassignedDepartments] = await Promise.all([
      db.company.findMany({ select: { id: true } }),
      db.department.findMany({
        where: { companyId: null },
        select: { id: true, name: true, active: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, companyId: true, groups: { select: groupSelect } },
      }),
    ]);
    const companyNodes = (await Promise.all(companies.map((company) => loadCompanyNode(company.id))))
      .filter((company): company is CompanyNode => company !== null)
      .map((company) => ({
        ...company,
        departments: company.departments.map((department) => ({ ...department, groups: filterGroupsInScope(actor, department, department.groups) })),
      }));
    const unassignedNodes: DepartmentNode[] = unassignedDepartments.map((department) => ({
      id: department.id,
      name: department.name,
      active: department.active,
      countryCode: department.countryCode,
      timezone: department.timezone,
      workStartMinutes: department.workStartMinutes,
      workEndMinutes: department.workEndMinutes,
      companyId: department.companyId,
      groups: filterGroupsInScope(actor, department, department.groups.map(toGroupNode)),
    }));
    return NextResponse.json({ companies: companyNodes, unassignedDepartments: unassignedNodes });
  }

  if (actor.duty === "COMPANY_MANAGER") {
    if (!actor.companyId) return NextResponse.json({ company: null });
    const company = await loadCompanyNode(actor.companyId);
    if (!company) return NextResponse.json({ company: null });
    const scoped = { ...company, departments: company.departments.map((department) => ({ ...department, groups: filterGroupsInScope(actor, department, department.groups) })) };
    return NextResponse.json({ company: scoped });
  }

  if (actor.duty === "DEPARTMENT_MANAGER") {
    const departmentIds = managedDepartmentIds(actor);
    if (!departmentIds.length) return NextResponse.json({ companies: [], unassignedDepartments: [] });
    const departments = (await Promise.all(departmentIds.map(loadDepartmentNode)))
      .filter((department): department is DepartmentNode => department !== null)
      .map((department) => ({ ...department, groups: filterGroupsInScope(actor, department, department.groups) }));
    const companyIds = [...new Set(departments.map((department) => department.companyId).filter((id): id is string => Boolean(id)))];
    const companyNames = new Map((await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, active: true } }))
      .map((company) => [company.id, company]));
    const companies = companyIds.map((companyId) => ({
      id: companyId,
      name: companyNames.get(companyId)?.name ?? "所属公司",
      active: companyNames.get(companyId)?.active ?? true,
      departments: departments.filter((department) => department.companyId === companyId),
    }));
    return NextResponse.json({ companies, unassignedDepartments: departments.filter((department) => !department.companyId) });
  }

  return authorizationDenied(actor, "没有权限查看组织结构");
}
