import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { requireAdminRequest } from "../_auth";
import { authorizeHighRiskOperation, HighRiskAuthorizationError } from "../_high-risk";
import { authorizationDenied } from "../../../../lib/security-events";
import { businessTimezoneOption, DEFAULT_WORK_END_MINUTES, DEFAULT_WORK_START_MINUTES, isSupportedBusinessTimezone } from "../../../../lib/business-time";
import { API_LIMITS } from "../../../../lib/request-limits";

type DepartmentRequest = { id?: unknown; name?: unknown; active?: unknown; timezone?: unknown; highRiskReason?: unknown; currentPassword?: unknown };

export async function POST(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;
  const body = (await request.json()) as DepartmentRequest;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone : "Asia/Shanghai";
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "下属公司名称必须在 1 到 100 个字之间" }, { status: 400 });
  if (!isSupportedBusinessTimezone(timezone)) return NextResponse.json({ error: "请选择支持的国家/时区" }, { status: 400 });
  try {
    const department = await db.$transaction(async (client) => {
      const option = businessTimezoneOption(timezone);
      const created = await client.department.create({ data: { id: randomUUID(), name, timezone, countryCode: option.countryCode, workStartMinutes: DEFAULT_WORK_START_MINUTES, workEndMinutes: DEFAULT_WORK_END_MINUTES } });
      await recordAudit(client, { actorId: access.actor.id, action: "DEPARTMENT_CREATED", entityType: "Department", entityId: created.id, summary: { changedFields: ["name", "timezone", "workStartMinutes", "workEndMinutes"] } });
      return created;
    });
    return NextResponse.json(department, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "下属公司名称已经存在" }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;
  const body = (await request.json()) as DepartmentRequest;
  if (typeof body.id !== "string" || body.id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "下属公司参数不正确" }, { status: 400 });
  if (typeof body.currentPassword === "string" && body.currentPassword.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: "当前管理员密码长度超过限制" }, { status: 400 });
  if (typeof body.highRiskReason === "string" && body.highRiskReason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "操作原因不能超过 500 个字" }, { status: 400 });
  const requested: { name?: string; active?: boolean; timezone?: string } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "下属公司名称必须在 1 到 100 个字之间" }, { status: 400 });
    requested.name = name;
  }
  if (typeof body.active === "boolean") {
    requested.active = body.active;
  }
  if (typeof body.timezone === "string") {
    if (!isSupportedBusinessTimezone(body.timezone)) return NextResponse.json({ error: "请选择支持的国家/时区" }, { status: 400 });
    requested.timezone = body.timezone;
  }
  if (!Object.keys(requested).length) return NextResponse.json({ error: "没有可更新的下属公司信息" }, { status: 400 });
  try {
    const result = await db.$transaction(async (client) => {
      const existing = await client.department.findUniqueOrThrow({ where: { id: body.id as string } });
      const data: { name?: string; active?: boolean; timezone?: string; countryCode?: string } = {};
      const changedFields: string[] = [];
      if (requested.name !== undefined && requested.name !== existing.name) {
        data.name = requested.name;
        changedFields.push("name");
      }
      if (requested.active !== undefined && requested.active !== existing.active) {
        data.active = requested.active;
        changedFields.push("active");
      }
      if (requested.timezone !== undefined && requested.timezone !== existing.timezone) {
        data.timezone = requested.timezone;
        data.countryCode = businessTimezoneOption(requested.timezone).countryCode;
        changedFields.push("timezone");
      }
      if (!changedFields.length) return { department: existing };
      const disablesDepartment = existing.active && data.active === false;
      if (disablesDepartment) {
        const activeGroups = await client.teamGroup.count({ where: { departmentId: existing.id, active: true } });
        if (activeGroups) return { error: "请先停用或移动该公司下的启用小组", status: 400 as const };
        const activeManagers = await client.user.count({ where: { departmentId: existing.id, role: "COMPANY_MANAGER", active: true } });
        if (activeManagers) return { error: "请先停用或转移该公司的公司管理员", status: 400 as const };
      }

      const highRisk = disablesDepartment
        ? await authorizeHighRiskOperation(client, access.actor.id, body)
        : null;
      const impact = highRisk
        ? await Promise.all([
          client.teamGroup.count({ where: { departmentId: existing.id } }),
          client.teamGroup.count({ where: { departmentId: existing.id, active: true } }),
          client.user.count({ where: { group: { departmentId: existing.id } } }),
          client.user.count({ where: { active: true, group: { departmentId: existing.id } } }),
          client.channel.count({ where: { group: { departmentId: existing.id } } }),
          client.channel.count({ where: { active: true, group: { departmentId: existing.id } } }),
          client.sourceBatch.count({ where: { group: { departmentId: existing.id } } }),
          client.user.count({ where: { departmentId: existing.id, role: "COMPANY_MANAGER" } }),
        ])
        : null;

      const updated = await client.department.update({ where: { id: existing.id }, data });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: changedFields.includes("active") ? "DEPARTMENT_STATUS_CHANGED" : "DEPARTMENT_UPDATED",
        entityType: "Department",
        entityId: updated.id,
        summary: {
          changedFields,
          ...(highRisk && impact ? {
            name: updated.name,
            highRiskReason: highRisk.highRiskReason,
            reauthenticated: highRisk.reauthenticated,
            before: { name: existing.name, active: existing.active },
            after: { name: updated.name, active: updated.active },
            impact: {
              groups: impact[0],
              activeGroups: impact[1],
              members: impact[2],
              activeMembers: impact[3],
              channels: impact[4],
              activeChannels: impact[5],
              sourceBatches: impact[6],
              companyManagers: impact[7],
            },
          } : {}),
        },
      });
      return { department: updated };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.department);
  } catch (error) {
    if (error instanceof HighRiskAuthorizationError) return error.status === 403 ? authorizationDenied(access.actor, error.message) : NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "下属公司名称已经存在" }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return NextResponse.json({ error: "下属公司不存在或已经删除" }, { status: 404 });
    throw error;
  }
}
