import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { businessTimezoneOption, isSupportedBusinessTimezone } from "../../../../lib/business-time";
import { db } from "../../../../lib/db";
import { copyGlobalChannelsToGroup } from "../../../../lib/global-channels";
import { canCreateGroup } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireOrgManagerRequest } from "../_auth";

type GroupRequest = { departmentId?: unknown; name?: unknown };

/**
 * 阶段5a：开设新小组（需求文档5.6，部门管理员限本部门、公司管理员限本公司、总公司管理员不限）。
 * 新组没有组长是正常状态（5.6原文），这条路由只管建组本身，任命组长走
 * POST /api/org/groups/[groupId]/lead，两件事拆开，不在一个请求里强求同时指定组长。
 *
 * 时区固定继承所属部门（1.2：组不能有自己独立的时区），不像老的 admin/groups/route.ts
 * 那样允许小组单独覆盖时区——那是老部门/小组两层结构留下的口子，阶段5的四层结构里
 * 不应该再放开这个口子，新组统一继承部门时区。
 */
export async function POST(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;

  const body = (await request.json()) as GroupRequest;
  const departmentId = typeof body.departmentId === "string" ? body.departmentId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!departmentId || departmentId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "请选择启用中的部门" }, { status: 400 });
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "小组名称必须在 1 到 100 个字之间" }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const department = await client.department.findFirst({ where: { id: departmentId, active: true }, select: { id: true, companyId: true, timezone: true } });
      if (!department) return { error: "请选择启用中的部门", status: 400 as const };
      if (!canCreateGroup(access.actor, department)) return { denied: true as const };

      const timezone = isSupportedBusinessTimezone(department.timezone) ? department.timezone : "Asia/Shanghai";
      const created = await client.teamGroup.create({
        data: { id: randomUUID(), name, departmentId, timezone, countryCode: businessTimezoneOption(timezone).countryCode },
      });
      const copiedChannels = await copyGlobalChannelsToGroup(client, created.id);
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "GROUP_CREATED",
        entityType: "TeamGroup",
        entityId: created.id,
        summary: { changedFields: ["name", "departmentId", "timezone"], copiedGlobalChannels: copiedChannels },
      });
      return { group: created };
    }, { isolationLevel: "Serializable" });
    if ("denied" in result) return authorizationDenied(access.actor, "没有权限在这个部门下新建小组");
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.group, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "该部门已经有同名小组" }, { status: 409 });
    throw error;
  }
}
