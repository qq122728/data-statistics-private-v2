import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { canCreateCompanyManagerAccount } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireAdminOrOrgManagerRequest } from "../_auth";

type CompanyManagerRequest = { companyId?: unknown; username?: unknown; name?: unknown; password?: unknown };

/**
 * 阶段5a补充：给一个已存在的公司开设 Duty.COMPANY_MANAGER 账号（需求文档5.6：总公司管理员
 * 可越级——这里不是越级到组长/部门管理员那一档，而是"公司管理员"这一档本身没有创建同档
 * 账号的权限，只有总公司才能新建，ADMIN 系统自举兜底）。
 *
 * 只创建账号，不建公司——公司必须已经通过 POST /api/org/companies（总公司管理员专属）
 * 建好。不接受也不校验部门/小组参数：Duty.COMPANY_MANAGER 账号只挂 companyId，
 * 不挂 departmentId/groupId（阶段5a的既有约定，见 org-permissions.ts 文件头注释）。
 */
export async function POST(request: Request) {
  const access = await requireAdminOrOrgManagerRequest();
  if ("response" in access) return access.response;
  if (!canCreateCompanyManagerAccount(access.actor)) return authorizationDenied(access.actor, "只有总公司管理员可以创建公司管理员账号");

  const body = (await request.json()) as CompanyManagerRequest;
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!companyId || companyId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "请选择启用中的公司" }, { status: 400 });
  if (!username || !name || !password) return NextResponse.json({ error: "请完整填写账号、姓名和临时密码" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || password.length > API_LIMITS.loginPasswordCharacters)
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) return NextResponse.json({ error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const company = await client.company.findFirst({ where: { id: companyId, active: true }, select: { id: true } });
      if (!company) return { error: "请选择启用中的公司", status: 400 as const };

      const created = await client.user.create({
        data: {
          id: randomUUID(),
          employeeCode: `OCM-${randomUUID().slice(0, 8).toUpperCase()}`,
          username,
          name,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          role: "COMPANY_MANAGER",
          duty: "COMPANY_MANAGER",
          companyId: company.id,
        },
        select: { id: true, username: true, name: true, role: true, duty: true, companyId: true, active: true, mustChangePassword: true },
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "ORG_COMPANY_MANAGER_ACCOUNT_CREATED",
        entityType: "User",
        entityId: created.id,
        summary: { changedFields: ["username", "name", "duty", "companyId"], companyId: company.id },
      });
      return { manager: created };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.manager, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
    throw error;
  }
}
