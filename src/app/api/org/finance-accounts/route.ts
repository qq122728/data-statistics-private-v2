import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireAdminOrOrgManagerRequest } from "../_auth";

type FinanceAccountRequest = {
  username?: unknown;
  name?: unknown;
  password?: unknown;
  financeGroupIds?: unknown;
};

export async function POST(request: Request) {
  const access = await requireAdminOrOrgManagerRequest();
  if ("response" in access) return access.response;
  if (access.actor.role !== "ADMIN" && access.actor.duty !== "HQ_MANAGER")
    return authorizationDenied(access.actor, "只有总公司管理员可以创建财务账号");

  const body = await request.json() as FinanceAccountRequest;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !name || !password) return NextResponse.json({ error: "请完整填写账号、姓名和密码" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || password.length > API_LIMITS.loginPasswordCharacters)
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) return NextResponse.json({ error: `密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });
  if (!Array.isArray(body.financeGroupIds) || !body.financeGroupIds.length || body.financeGroupIds.length > API_LIMITS.batchRows
    || body.financeGroupIds.some((id) => typeof id !== "string" || !id || id.length > API_LIMITS.identifierCharacters))
    return NextResponse.json({ error: "请至少选择一个有效的财务可见小组" }, { status: 400 });
  const financeGroupIds = [...new Set(body.financeGroupIds as string[])];

  try {
    const result = await db.$transaction(async (client) => {
      const groups = await client.teamGroup.findMany({
        where: { id: { in: financeGroupIds }, active: true, department: { active: true } },
        select: { id: true },
      });
      if (groups.length !== financeGroupIds.length)
        return { error: "所选小组不存在或已停用", status: 400 as const };

      const created = await client.user.create({
        data: {
          id: randomUUID(),
          employeeCode: `FIN-${randomUUID().slice(0, 8).toUpperCase()}`,
          username,
          name,
          passwordHash: hashPassword(password),
          mustChangePassword: false,
          role: "FINANCE",
          duty: "FINANCE",
          financeScopeConfigured: true,
          roleAssignments: { create: { role: "FINANCE" } },
          financeGroupAccess: { create: financeGroupIds.map((groupId) => ({ groupId })) },
        },
        select: {
          id: true, username: true, name: true, role: true, duty: true,
          active: true, mustChangePassword: true,
          financeGroupAccess: { select: { groupId: true }, orderBy: { groupId: "asc" } },
        },
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "ORG_FINANCE_ACCOUNT_CREATED",
        entityType: "User",
        entityId: created.id,
        summary: { changedFields: ["username", "name", "role", "financeGroupIds"], financeGroupIds },
      });
      return { account: created };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.account, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
    throw error;
  }
}
