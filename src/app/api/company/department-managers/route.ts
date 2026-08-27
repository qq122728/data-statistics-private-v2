import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { requireCompanyManagerRequest } from "../../../../lib/company-organization";
import { db } from "../../../../lib/db";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

export async function POST(request: Request) {
  const access = await requireCompanyManagerRequest();
  if ("response" in access) return access.response;
  if (access.company.managementCountryCode) return authorizationDenied(access.actor, "部门管理员不能继续创建其他管理账号");

  const body = await request.json() as Record<string, unknown>;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const managementScopeName = typeof body.managementScopeName === "string" ? body.managementScopeName.trim() : "";
  const managementCountryCode = typeof body.managementCountryCode === "string" ? body.managementCountryCode.trim().toUpperCase() : "";
  if (!username || !name || !password || !managementScopeName || !/^[A-Z]{2}$/.test(managementCountryCode)) return NextResponse.json({ error: "请完整填写账号、姓名、部门名称、市场国家和临时密码" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || managementScopeName.length > 60 || password.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: "账号、姓名、部门名称或密码长度超过限制" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) return NextResponse.json({ error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });

  try {
    const manager = await db.$transaction(async (tx) => {
      const groupExists = await tx.teamGroup.findFirst({ where: { departmentId: access.company.id, active: true, OR: [{ countryCode: managementCountryCode }, { countryCode: null, department: { countryCode: managementCountryCode } }] }, select: { id: true } });
      if (!groupExists) return { error: "该公司还没有这个市场国家的小组，请先创建或调整小组国家", status: 400 as const };
      const created = await tx.user.create({ data: {
        id: randomUUID(), employeeCode: `DM-${randomUUID().slice(0, 8).toUpperCase()}`, username, name,
        passwordHash: hashPassword(password), mustChangePassword: true, role: "COMPANY_MANAGER",
        departmentId: access.company.id, managementScopeName, managementCountryCode,
      }, select: { id: true, username: true, name: true, managementScopeName: true, managementCountryCode: true, active: true } });
      await recordAudit(tx, { actorId: access.actor.id, action: "DEPARTMENT_MANAGER_CREATED", entityType: "User", entityId: created.id, summary: { changedFields: ["role", "departmentId", "managementScopeName", "managementCountryCode"], companyId: access.company.id, managementScopeName, managementCountryCode } });
      return { manager: created };
    });
    if ("error" in manager) return NextResponse.json({ error: manager.error }, { status: manager.status });
    return NextResponse.json(manager.manager, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
    throw error;
  }
}
