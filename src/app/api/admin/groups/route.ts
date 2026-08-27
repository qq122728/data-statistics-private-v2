import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { requireAdminRequest } from "../_auth";
import { authorizeHighRiskOperation, HighRiskAuthorizationError } from "../_high-risk";
import { authorizationDenied } from "../../../../lib/security-events";
import { businessTimezoneOption, isSupportedBusinessTimezone } from "../../../../lib/business-time";
import { copyGlobalChannelsToGroup } from "../../../../lib/global-channels";
import { API_LIMITS } from "../../../../lib/request-limits";

type GroupRequest = { id?: unknown; name?: unknown; departmentId?: unknown; active?: unknown; timezone?: unknown; highRiskReason?: unknown; currentPassword?: unknown };

function requestedTimezone(value: unknown): string | null | undefined | "INVALID" {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return typeof value === "string" && isSupportedBusinessTimezone(value) ? value : "INVALID";
}

export async function POST(request: Request) {
  const access = await requireAdminRequest(); if ("response" in access) return access.response;
  const body = (await request.json()) as GroupRequest;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const departmentId = typeof body.departmentId === "string" ? body.departmentId : "";
  const timezone = requestedTimezone(body.timezone);
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "小组名称必须在 1 到 100 个字之间" }, { status: 400 });
  if (!departmentId || departmentId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "请选择启用中的下属公司" }, { status: 400 });
  if (timezone === "INVALID") return NextResponse.json({ error: "请选择支持的国家/时区" }, { status: 400 });
  try {
    const result = await db.$transaction(async (client) => {
      if (!await client.department.findFirst({ where: { id: departmentId, active: true }, select: { id: true } })) {
        return { error: "请选择启用中的下属公司", status: 400 as const };
      }
      const created = await client.teamGroup.create({ data: { id: randomUUID(), name, departmentId, timezone: timezone ?? null, countryCode: timezone ? businessTimezoneOption(timezone).countryCode : null } });
      const copiedChannels = await copyGlobalChannelsToGroup(client, created.id);
      await recordAudit(client, { actorId: access.actor.id, action: "GROUP_CREATED", entityType: "TeamGroup", entityId: created.id, summary: { changedFields: ["name", "departmentId", "timezone"], copiedGlobalChannels: copiedChannels } });
      return { group: created };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.group, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "该下属公司已经有同名小组" }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requireAdminRequest(); if ("response" in access) return access.response;
  const body = (await request.json()) as GroupRequest;
  if (typeof body.id !== "string" || body.id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "小组参数不正确" }, { status: 400 });
  if (typeof body.currentPassword === "string" && body.currentPassword.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: "当前管理员密码长度超过限制" }, { status: 400 });
  if (typeof body.highRiskReason === "string" && body.highRiskReason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "操作原因不能超过 500 个字" }, { status: 400 });
  const requested: { name?: string; departmentId?: string; active?: boolean; timezone?: string | null } = {};
  if (typeof body.name === "string") { const name = body.name.trim(); if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "小组名称必须在 1 到 100 个字之间" }, { status: 400 }); requested.name = name; }
  if (typeof body.active === "boolean") requested.active = body.active;
  if (typeof body.departmentId === "string") {
    if (body.departmentId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "下属公司参数过长" }, { status: 400 });
    requested.departmentId = body.departmentId;
  }
  const timezone = requestedTimezone(body.timezone);
  if (timezone === "INVALID") return NextResponse.json({ error: "请选择支持的国家/时区" }, { status: 400 });
  if (timezone !== undefined) requested.timezone = timezone;
  if (!Object.keys(requested).length) return NextResponse.json({ error: "没有可更新的小组信息" }, { status: 400 });
  try {
    const group = await db.$transaction(async (client) => {
      const existing = await client.teamGroup.findUniqueOrThrow({
        where: { id: body.id as string },
        include: { department: { select: { id: true, name: true, active: true } } },
      });
      const data: { name?: string; departmentId?: string; active?: boolean; timezone?: string | null; countryCode?: string | null } = {};
      const changedFields: string[] = [];
      if (requested.name !== undefined && requested.name !== existing.name) {
        data.name = requested.name;
        changedFields.push("name");
      }
      if (requested.active !== undefined && requested.active !== existing.active) {
        data.active = requested.active;
        changedFields.push("active");
      }
      if (requested.departmentId !== undefined && requested.departmentId !== existing.departmentId) {
        data.departmentId = requested.departmentId;
        changedFields.push("departmentId");
      }
      if (requested.timezone !== undefined && requested.timezone !== existing.timezone) {
        data.timezone = requested.timezone;
        data.countryCode = requested.timezone ? businessTimezoneOption(requested.timezone).countryCode : null;
        changedFields.push("timezone");
      }
      if (!changedFields.length) {
        const { department: _department, ...unchanged } = existing;
        return { group: unchanged };
      }
      const nextDepartmentId = data.departmentId ?? existing.departmentId;
      const nextActive = data.active ?? existing.active;
      const activeDepartment = await client.department.findFirst({ where: { id: nextDepartmentId, active: true }, select: { id: true } });
      if (data.departmentId !== undefined && !activeDepartment) {
        return { error: "请选择启用中的下属公司", status: 400 as const };
      }
      if (nextActive && !activeDepartment) {
        return { error: "上级下属公司已停用，不能启用该小组", status: 400 as const };
      }

      const disablesGroup = existing.active && data.active === false;
      const highRisk = disablesGroup
        ? await authorizeHighRiskOperation(client, access.actor.id, body)
        : null;
      const impact = highRisk
        ? await Promise.all([
          client.user.count({ where: { groupId: existing.id } }),
          client.user.count({ where: { groupId: existing.id, active: true } }),
          client.channel.count({ where: { groupId: existing.id } }),
          client.channel.count({ where: { groupId: existing.id, active: true } }),
          client.sourceBatch.count({ where: { groupId: existing.id } }),
          client.device.count({ where: { groupId: existing.id } }),
          client.deviceAccount.count({ where: { groupId: existing.id } }),
        ])
        : null;

      const updated = await client.teamGroup.update({
        where: { id: existing.id },
        data,
        include: { department: { select: { id: true, name: true } } },
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: changedFields.includes("active") ? "GROUP_STATUS_CHANGED" : "GROUP_UPDATED",
        entityType: "TeamGroup",
        entityId: updated.id,
        summary: {
          changedFields,
          ...(highRisk && impact ? {
            name: updated.name,
            highRiskReason: highRisk.highRiskReason,
            reauthenticated: highRisk.reauthenticated,
            before: {
              name: existing.name,
              active: existing.active,
              departmentId: existing.departmentId,
              departmentName: existing.department.name,
            },
            after: {
              name: updated.name,
              active: updated.active,
              departmentId: updated.departmentId,
              departmentName: updated.department.name,
            },
            impact: {
              members: impact[0],
              activeMembers: impact[1],
              channels: impact[2],
              activeChannels: impact[3],
              sourceBatches: impact[4],
              devices: impact[5],
              deviceAccounts: impact[6],
            },
          } : {}),
        },
      });
      const { department: _department, ...plainGroup } = updated;
      return { group: plainGroup };
    }, { isolationLevel: "Serializable" });
    if ("error" in group) return NextResponse.json({ error: group.error }, { status: group.status });
    return NextResponse.json(group.group);
  } catch (error) {
    if (error instanceof HighRiskAuthorizationError) return error.status === 403 ? authorizationDenied(access.actor, error.message) : NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "该下属公司已经有同名小组" }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return NextResponse.json({ error: "小组不存在或已经删除" }, { status: 404 });
    throw error;
  }
}
