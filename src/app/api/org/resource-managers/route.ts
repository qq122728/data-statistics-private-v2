import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireAdminOrOrgManagerRequest } from "../_auth";

type ResourceManagerRequest = {
  username?: unknown;
  name?: unknown;
  password?: unknown;
  resourceChannelIds?: unknown;
};

/**
 * 总公司先建立渠道目录，再给同一种渠道类型创建资源账号。
 * 资源账号不挂公司、部门或小组，只通过 ResourceChannelAccess 决定能看到哪些数据。
 */
export async function POST(request: Request) {
  const access = await requireAdminOrOrgManagerRequest();
  if ("response" in access) return access.response;
  if (access.actor.role !== "ADMIN" && access.actor.duty !== "HQ_MANAGER")
    return authorizationDenied(access.actor, "只有总公司管理员可以创建资源部账号");

  const body = await request.json() as ResourceManagerRequest;
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const resourceChannelIds = Array.isArray(body.resourceChannelIds)
    ? [...new Set(body.resourceChannelIds.filter((value): value is string => typeof value === "string" && Boolean(value)))]
    : [];

  if (!username || !name || !password) return NextResponse.json({ error: "请完整填写账号、姓名和临时密码" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || password.length > API_LIMITS.loginPasswordCharacters)
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) return NextResponse.json({ error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });
  if (!resourceChannelIds.length) return NextResponse.json({ error: "请先创建渠道，再至少选择一个渠道" }, { status: 400 });
  if (resourceChannelIds.length > API_LIMITS.batchRows || resourceChannelIds.some((id) => id.length > API_LIMITS.identifierCharacters))
    return NextResponse.json({ error: "资源渠道参数不正确" }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const channels = await client.channel.findMany({
        where: { id: { in: resourceChannelIds }, active: true },
        select: { id: true, name: true, channelType: true },
      });
      const catalog = [...new Map(channels.map((channel) => [channel.id, channel])).values()];
      if (catalog.length !== resourceChannelIds.length)
        return { error: "选择的渠道不存在或已停用", status: 400 as const };
      const channelTypes = new Set(catalog.map((channel) => channel.channelType));
      if (channelTypes.size !== 1)
        return { error: "一个资源部账号只能选择一种渠道类型（投流或短信）", status: 400 as const };
      const channelType = catalog[0].channelType;
      if (channelType !== "ADS" && channelType !== "SMS")
        return { error: "资源部账号只能选择投流或短信渠道", status: 400 as const };

      const created = await client.user.create({
        data: {
          id: randomUUID(),
          employeeCode: `RES-${randomUUID().slice(0, 8).toUpperCase()}`,
          username,
          name,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          role: "RESOURCE_MANAGER",
          duty: "RESOURCE_MANAGER",
          resourceChannelAccess: { create: resourceChannelIds.map((channelId) => ({ channelId })) },
        },
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          duty: true,
          active: true,
          mustChangePassword: true,
          resourceChannelAccess: { select: { channelId: true }, orderBy: { channelId: "asc" } },
        },
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "ORG_RESOURCE_MANAGER_ACCOUNT_CREATED",
        entityType: "User",
        entityId: created.id,
        summary: {
          changedFields: ["username", "name", "role", "resourceChannelIds"],
          channelType,
          resourceChannelIds,
        },
      });
      return { manager: created };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.manager, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
    throw error;
  }
}
