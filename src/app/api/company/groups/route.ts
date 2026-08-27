import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { companyManagedGroupWhere, getActiveCompanyScope, requireCompanyManagerRequest } from "../../../../lib/company-organization";
import { db } from "../../../../lib/db";
import { businessTimezoneOption, isSupportedBusinessTimezone } from "../../../../lib/business-time";
import { copyGlobalChannelsToGroup } from "../../../../lib/global-channels";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

type GroupRequest = { id?: unknown; name?: unknown; departmentId?: unknown; active?: unknown; timezone?: unknown };

function parseTimezone(value: unknown): string | null | "INVALID" {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && isSupportedBusinessTimezone(value) ? value : "INVALID";
}

export async function POST(request: Request) {
  const access = await requireCompanyManagerRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as GroupRequest;
  if (Object.prototype.hasOwnProperty.call(body, "departmentId") || Object.prototype.hasOwnProperty.call(body, "active")) {
    return NextResponse.json({ error: "公司管理员不能指定其他公司或直接修改小组状态" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const timezone = parseTimezone(body.timezone);
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "小组名称必须在 1 到 100 个字之间" }, { status: 400 });
  if (timezone === "INVALID") return NextResponse.json({ error: "请选择支持的国家/时区" }, { status: 400 });
  try {
    const result = await db.$transaction(async (client) => {
      const company = await getActiveCompanyScope(access.actor.id, client);
      if (!company) return { error: "公司管理员必须绑定启用中的下属公司", status: 403 as const };
      const requestedCountry = timezone ? businessTimezoneOption(timezone).countryCode : company.countryCode;
      if (company.managementCountryCode && requestedCountry !== company.managementCountryCode) return { error: "部门管理员只能创建本部门市场国家的小组", status: 403 as const };
      const group = await client.teamGroup.create({ data: { id: randomUUID(), name, departmentId: company.id, timezone, countryCode: timezone ? businessTimezoneOption(timezone).countryCode : null } });
      const copiedChannels = await copyGlobalChannelsToGroup(client, group.id);
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "GROUP_CREATED",
        entityType: "TeamGroup",
        entityId: group.id,
        summary: { changedFields: ["name", "departmentId", "timezone"], companyId: company.id, companyName: company.name, copiedGlobalChannels: copiedChannels },
      });
      return { group };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return result.status === 403 ? authorizationDenied(access.actor, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.group, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "本公司已经有同名小组" }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requireCompanyManagerRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as GroupRequest;
  if (typeof body.id !== "string" || body.id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "小组参数不正确" }, { status: 400 });
  if (Object.prototype.hasOwnProperty.call(body, "departmentId") || Object.prototype.hasOwnProperty.call(body, "active")) {
    return NextResponse.json({ error: "公司管理员不能移动或停用小组" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const timezone = parseTimezone(body.timezone);
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "小组名称必须在 1 到 100 个字之间" }, { status: 400 });
  if (timezone === "INVALID") return NextResponse.json({ error: "请选择支持的国家/时区" }, { status: 400 });
  try {
    const result = await db.$transaction(async (client) => {
      const company = await getActiveCompanyScope(access.actor.id, client);
      if (!company) return { error: "公司管理员必须绑定启用中的下属公司", status: 403 as const };
      const existing = await client.teamGroup.findFirst({ where: { id: body.id as string, ...companyManagedGroupWhere(company) }, select: { id: true, name: true, timezone: true } });
      if (!existing) return { error: "无权管理该小组", status: 403 as const };
      const requestedCountry = timezone ? businessTimezoneOption(timezone).countryCode : company.countryCode;
      if (company.managementCountryCode && requestedCountry !== company.managementCountryCode) return { error: "部门管理员不能把小组改到其他市场", status: 403 as const };
      if (existing.name === name && existing.timezone === timezone) return { group: existing };
      const group = await client.teamGroup.update({ where: { id: existing.id }, data: { name, timezone, countryCode: timezone ? businessTimezoneOption(timezone).countryCode : null } });
      await recordAudit(client, { actorId: access.actor.id, action: "GROUP_UPDATED", entityType: "TeamGroup", entityId: group.id, summary: { changedFields: [existing.name === name ? "timezone" : "name", ...(existing.name !== name && existing.timezone !== timezone ? ["timezone"] : [])], before: { name: existing.name, timezone: existing.timezone }, after: { name: group.name, timezone: group.timezone }, companyId: company.id } });
      return { group };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return result.status === 403 ? authorizationDenied(access.actor, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.group);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "本公司已经有同名小组" }, { status: 409 });
    throw error;
  }
}
