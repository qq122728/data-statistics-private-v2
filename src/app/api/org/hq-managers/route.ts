import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { canCreateHqManagerAccount } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireAdminOrOrgManagerRequest } from "../_auth";

type HqManagerRequest = { username?: unknown; name?: unknown; password?: unknown };

/**
 * 阶段5a补充：新建 Duty.HQ_MANAGER 账号——纯系统自举操作，只有 ADMIN 能做（见
 * org-permissions.ts 的 canCreateHqManagerAccount 注释：业务层级里没有比总公司更高的
 * 档位能授权这件事，连现任总公司管理员本人也不行，等价于"谁创建第一个 admin 账号"）。
 *
 * 没有范围参数——HQ_MANAGER 不挂 companyId/departmentId/groupId（命中即放行全局，
 * 阶段5a既有约定）。这里仍然走 requireAdminOrOrgManagerRequest 这个粗闸门（会放行
 * 现任 HQ_MANAGER 本人），真正把非 ADMIN 调用方挡在外面的是 canCreateHqManagerAccount
 * 这一步——跟其它 org/* 路由"粗闸门 + can* 细判"的两层结构保持一致，不为这一条路由
 * 单独发明一个更严格的登录闸门。
 */
export async function POST(request: Request) {
  const access = await requireAdminOrOrgManagerRequest();
  if ("response" in access) return access.response;
  if (!canCreateHqManagerAccount(access.actor)) return authorizationDenied(access.actor, "只有系统管理员可以创建总公司管理员账号");

  const body = (await request.json()) as HqManagerRequest;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !name || !password) return NextResponse.json({ error: "请完整填写账号、姓名和临时密码" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || password.length > API_LIMITS.loginPasswordCharacters)
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) return NextResponse.json({ error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });

  try {
    const manager = await db.$transaction(async (client) => {
      const created = await client.user.create({
        data: {
          id: randomUUID(),
          employeeCode: `OHQ-${randomUUID().slice(0, 8).toUpperCase()}`,
          username,
          name,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          role: "COMPANY_MANAGER",
          duty: "HQ_MANAGER",
        },
        select: { id: true, username: true, name: true, role: true, duty: true, active: true, mustChangePassword: true },
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "ORG_HQ_MANAGER_ACCOUNT_CREATED",
        entityType: "User",
        entityId: created.id,
        summary: { changedFields: ["username", "name", "duty"] },
      });
      return created;
    });
    return NextResponse.json(manager, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
    throw error;
  }
}
