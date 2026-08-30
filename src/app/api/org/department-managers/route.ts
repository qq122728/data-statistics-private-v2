import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { canCreateDepartmentManagerAccount } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireAdminOrOrgManagerRequest } from "../_auth";

type DepartmentManagerRequest = { departmentId?: unknown; username?: unknown; name?: unknown; password?: unknown };

/**
 * 阶段5a补充：给一个已存在的部门开设 Duty.DEPARTMENT_MANAGER 账号（需求文档5.6：
 * 公司管理员在本公司内可越级任免部门管理员；总公司管理员不限；ADMIN 系统自举兜底）。
 *
 * 这条路由只创建账号本身，不建部门——部门必须已经通过 POST /api/org/departments
 * （总公司管理员专属）建好，跟 groups/[groupId]/lead 路由"只任命组长、不建组"是
 * 同一个拆分原则：一件事只有一个入口。
 *
 * 跟老的 src/app/api/company/department-managers/route.ts 不是同一条路由，也不共享
 * 任何逻辑——那条服务的是老 Role.COMPANY_MANAGER 视角（按国家找小组核实市场存在，
 * 建出来的账号 role 就是真实的 COMPANY_MANAGER），这条服务新的
 * Company→Department→TeamGroup 四层结构，两条路由路径接近只是巧合，不是彼此的替代。
 *
 * `role` 字段固定填 `"COMPANY_MANAGER"` 占位（跟阶段5a一次性回填脚本把老
 * Role.COMPANY_MANAGER 账号的 duty 补成 DEPARTMENT_MANAGER 是同一个占位惯例——
 * 新权限网关完全不读这个字段，只是 schema 要求非空，不代表账号的真实语义）。
 */
export async function POST(request: Request) {
  const access = await requireAdminOrOrgManagerRequest();
  if ("response" in access) return access.response;

  const body = (await request.json()) as DepartmentManagerRequest;
  const departmentId = typeof body.departmentId === "string" ? body.departmentId : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!departmentId || departmentId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "请选择启用中的部门" }, { status: 400 });
  if (!username || !name || !password) return NextResponse.json({ error: "请完整填写账号、姓名和临时密码" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || password.length > API_LIMITS.loginPasswordCharacters)
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) return NextResponse.json({ error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const department = await client.department.findFirst({ where: { id: departmentId, active: true }, select: { id: true, companyId: true } });
      if (!department) return { error: "请选择启用中的部门", status: 400 as const };
      if (!canCreateDepartmentManagerAccount(access.actor, department)) return { denied: true as const };

      const created = await client.user.create({
        data: {
          id: randomUUID(),
          employeeCode: `ODM-${randomUUID().slice(0, 8).toUpperCase()}`,
          username,
          name,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          role: "COMPANY_MANAGER",
          duty: "DEPARTMENT_MANAGER",
          departmentId: department.id,
          managedDepartments: { create: { departmentId: department.id } },
        },
        select: { id: true, username: true, name: true, role: true, duty: true, departmentId: true, active: true, mustChangePassword: true },
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "ORG_DEPARTMENT_MANAGER_ACCOUNT_CREATED",
        entityType: "User",
        entityId: created.id,
        summary: { changedFields: ["username", "name", "duty", "departmentId"], departmentId: department.id, companyId: department.companyId },
      });
      return { manager: created };
    }, { isolationLevel: "Serializable" });
    if ("denied" in result) return authorizationDenied(access.actor, "没有权限给这个部门创建管理员账号");
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.manager, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
    throw error;
  }
}
