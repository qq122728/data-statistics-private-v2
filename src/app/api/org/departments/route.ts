import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { businessTimezoneOption, DEFAULT_WORK_END_MINUTES, DEFAULT_WORK_START_MINUTES, isSupportedBusinessTimezone } from "../../../../lib/business-time";
import { db } from "../../../../lib/db";
import { canCreateDepartment } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireOrgManagerRequest } from "../_auth";

type DepartmentRequest = { companyId?: unknown; name?: unknown; timezone?: unknown };

/**
 * 阶段5a：总公司管理员在某个公司下新建部门（需求文档5.6/1.2：国家属性挂在部门这一层，
 * 组只能继承所属部门的时区，不能有自己独立的时区）。
 *
 * 跟老的 admin/departments/route.ts 不是同一条路由——那条是 ADMIN 专用、不挂 companyId
 * 的老入口，阶段5之前没有公司层级可挂，本次不改它。这条新路由强制要求 companyId，
 * 是阶段5"公司→部门→小组"四层结构真正落地的入口。
 */
export async function POST(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  if (!canCreateDepartment(access.actor)) return authorizationDenied(access.actor, "只有总公司管理员可以新建部门");

  const body = (await request.json()) as DepartmentRequest;
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone : "Asia/Shanghai";
  if (!companyId || companyId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "请选择启用中的公司" }, { status: 400 });
  if (!name || name.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "部门名称必须在 1 到 100 个字之间" }, { status: 400 });
  if (!isSupportedBusinessTimezone(timezone)) return NextResponse.json({ error: "请选择支持的国家/时区" }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const company = await client.company.findFirst({ where: { id: companyId, active: true }, select: { id: true } });
      if (!company) return { error: "请选择启用中的公司", status: 400 as const };
      const option = businessTimezoneOption(timezone);
      const created = await client.department.create({
        data: { id: randomUUID(), name, companyId, timezone, countryCode: option.countryCode, workStartMinutes: DEFAULT_WORK_START_MINUTES, workEndMinutes: DEFAULT_WORK_END_MINUTES },
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "DEPARTMENT_CREATED",
        entityType: "Department",
        entityId: created.id,
        summary: { changedFields: ["name", "companyId", "timezone", "workStartMinutes", "workEndMinutes"], companyId },
      });
      return { department: created };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.department, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "部门名称已经存在" }, { status: 409 });
    throw error;
  }
}
