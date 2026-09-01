import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { businessTimezoneOption, isSupportedBusinessTimezone } from "../../../../lib/business-time";
import { db } from "../../../../lib/db";
import { copyGlobalChannelsToGroup } from "../../../../lib/global-channels";
import { canAppointOrTransferLead, canCreateGroup } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireOrgManagerRequest } from "../_auth";

type GroupRequest = {
  id?: unknown;
  departmentId?: unknown;
  name?: unknown;
  groupType?: unknown;
  active?: unknown;
  leadAccount?: {
    name?: unknown;
    username?: unknown;
    password?: unknown;
    effectiveOn?: unknown;
  } | null;
};

/**
 * 阶段5a：开设新小组（需求文档5.6，部门管理员限本部门、公司管理员限本公司、总公司管理员不限）。
 * 这里只创建小组。组创建成功后，再调用 /api/org/groups/[groupId]/lead 任命已有人员，
 * 或调用独立的组长账号创建入口。后端也强制两步，避免绕过“先有父级，再开账号”的业务顺序。
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
  const groupType: "HACKER" | "LAWYER" | null = body.groupType === undefined
    ? "HACKER"
    : body.groupType === "HACKER" || body.groupType === "LAWYER" ? body.groupType : null;
  if (!departmentId || departmentId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "请选择启用中的部门" }, { status: 400 });
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "小组名称必须在 1 到 100 个字之间" }, { status: 400 });
  if (!groupType) return NextResponse.json({ error: "请选择黑客组或律师组" }, { status: 400 });
  if (body.leadAccount !== undefined && body.leadAccount !== null)
    return NextResponse.json({ error: "请先创建小组；小组创建成功后，再单独创建或任命组长账号" }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const department = await client.department.findFirst({ where: { id: departmentId, active: true }, select: { id: true, companyId: true, timezone: true } });
      if (!department) return { error: "请选择启用中的部门", status: 400 as const };
      if (!canCreateGroup(access.actor, department)) return { denied: true as const };

      const timezone = isSupportedBusinessTimezone(department.timezone) ? department.timezone : "Asia/Shanghai";
      const created = await client.teamGroup.create({
        data: { id: randomUUID(), name, groupType, departmentId, timezone, countryCode: businessTimezoneOption(timezone).countryCode },
      });
      const copiedChannels = await copyGlobalChannelsToGroup(client, created.id);
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "GROUP_CREATED",
        entityType: "TeamGroup",
        entityId: created.id,
        summary: { changedFields: ["name", "groupType", "departmentId", "timezone"], groupType, copiedGlobalChannels: copiedChannels },
      });
      return { group: created, copiedChannels };
    }, { isolationLevel: "Serializable" });
    if ("denied" in result) return authorizationDenied(access.actor, "没有权限在这个部门下新建小组");
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "该部门已经有同名小组" }, { status: 409 });
    throw error;
  }
}

/**
 * 组织管理工作台修改小组名称或启停状态。不允许在这里移动部门或改时区。
 */
export async function PATCH(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;

  const body = (await request.json()) as GroupRequest;
  const id = typeof body.id === "string" ? body.id : "";
  const hasName = typeof body.name === "string";
  const hasActive = typeof body.active === "boolean";
  const name = hasName ? (body.name as string).trim() : "";
  if (!id || id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "小组参数不正确" }, { status: 400 });
  if (!hasName && !hasActive) return NextResponse.json({ error: "请填写要修改的小组名称或状态" }, { status: 400 });
  if (hasName && (!name || name.length > API_LIMITS.accountDisplayNameCharacters)) return NextResponse.json({ error: "小组名称必须在 1 到 100 个字之间" }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const existing = await client.teamGroup.findUnique({
        where: { id },
        select: { id: true, name: true, active: true, departmentId: true, department: { select: { companyId: true } } },
      });
      if (!existing) return { error: "小组不存在", status: 404 as const };
      if (!canAppointOrTransferLead(access.actor, { id: existing.id, departmentId: existing.departmentId, companyId: existing.department.companyId })) {
        return { denied: true as const };
      }
      if ((!hasName || existing.name === name) && (!hasActive || existing.active === body.active)) return { group: existing };

      const updated = await client.teamGroup.update({ where: { id }, data: {
        ...(hasName ? { name } : {}),
        ...(hasActive ? { active: body.active as boolean } : {}),
      } });
      const changedFields = [
        ...(hasName && existing.name !== name ? ["name"] : []),
        ...(hasActive && existing.active !== body.active ? ["active"] : []),
      ];
      await recordAudit(client, {
        actorId: access.actor.id,
        action: hasActive && existing.active !== body.active ? "GROUP_STATUS_CHANGED" : "GROUP_UPDATED",
        entityType: "TeamGroup",
        entityId: existing.id,
        summary: { changedFields, previousName: existing.name, name: updated.name, previousActive: existing.active, active: updated.active },
      });
      return { group: updated };
    }, { isolationLevel: "Serializable" });
    if ("denied" in result) return authorizationDenied(access.actor, "没有权限编辑这个小组");
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.group);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "该部门已经有同名小组" }, { status: 409 });
    throw error;
  }
}
