import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { API_LIMITS } from "../../../../../lib/request-limits";
import { parseFrontlineSecondaryRoles } from "../../../../../lib/role-assignments";
import { authorizationDenied } from "../../../../../lib/security-events";
import { transferableRoles, transferUserPosition, type TransferableRole } from "../../../../../lib/user-position/transfer";
import { requirePersonnelTransferRequest } from "../../_auth";
import { getSystemSettings } from "../../../../../lib/settings";
import { resolveGroupBusinessDate } from "../../../../../lib/business-time";
import type { Prisma } from "@prisma/client";

function scopeGroupWhere(actor: { role: string; duty: string | null; groupId: string | null; departmentId: string | null; companyId: string | null }): Prisma.TeamGroupWhereInput | null {
  if (actor.role === "ADMIN" || actor.duty === "HQ_MANAGER") return {};
  if (actor.duty === "COMPANY_MANAGER" && actor.companyId) return { department: { companyId: actor.companyId } };
  if (actor.duty === "DEPARTMENT_MANAGER" && actor.departmentId) return { departmentId: actor.departmentId };
  if ((actor.role === "LEAD" || actor.duty === "LEAD") && actor.groupId) return { id: actor.groupId };
  if (actor.role === "COMPANY_MANAGER" && actor.departmentId) return { departmentId: actor.departmentId };
  return null;
}

export async function GET() {
  const access = await requirePersonnelTransferRequest();
  if ("response" in access) return access.response;
  const where = scopeGroupWhere(access.actor);
  if (!where) return authorizationDenied(access.actor, "当前账号尚未配置人员管理范围");
  const groups = await db.teamGroup.findMany({
    where: { AND: [where, { active: true, department: { active: true } }] },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true, name: true, departmentId: true,
      department: { select: { name: true, companyId: true, company: { select: { name: true } } } },
      members: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, duty: true, groupId: true, roleAssignments: { select: { role: true } } } },
    },
  });
  return NextResponse.json({ groups });
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export async function POST(request: Request) {
  const access = await requirePersonnelTransferRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const targetGroupId = typeof body.targetGroupId === "string" ? body.targetGroupId : "";
  const role = typeof body.role === "string" && transferableRoles.includes(body.role as TransferableRole) ? body.role as TransferableRole : null;
  const effectiveOn = body.effectiveOn;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const receptionHandoffId = typeof body.receptionHandoffId === "string" && body.receptionHandoffId ? body.receptionHandoffId : null;
  const operatorHandoffId = typeof body.operatorHandoffId === "string" && body.operatorHandoffId ? body.operatorHandoffId : null;
  const expertHandoffId = typeof body.expertHandoffId === "string" && body.expertHandoffId ? body.expertHandoffId : null;
  const mode = body.mode === "preview" ? "preview" : "confirm";
  const rawExpected = body.expectedCounts as Record<string, unknown> | undefined;
  const expectedCounts = rawExpected && [rawExpected.reception, rawExpected.operator, rawExpected.expert].every((value) => Number.isInteger(value) && Number(value) >= 0)
    ? { reception: Number(rawExpected.reception), operator: Number(rawExpected.operator), expert: Number(rawExpected.expert) }
    : null;
  if (!userId || userId.length > API_LIMITS.identifierCharacters || !targetGroupId || targetGroupId.length > API_LIMITS.identifierCharacters)
    return NextResponse.json({ error: "人员或目标小组参数不正确" }, { status: 400 });
  if (!role) return NextResponse.json({ error: "请选择调动后的主岗位" }, { status: 400 });
  if (!isDate(effectiveOn)) return NextResponse.json({ error: "请选择正确的生效日期" }, { status: 400 });
  if (reason.length < 4 || reason.length > API_LIMITS.accountReasonCharacters)
    return NextResponse.json({ error: "调动原因需要填写 4 到 500 个字" }, { status: 400 });
  const secondaryRoles = parseFrontlineSecondaryRoles(role, body.secondaryRoles);
  if (!secondaryRoles.success) return NextResponse.json({ error: secondaryRoles.error }, { status: 400 });
  const settings = await getSystemSettings();
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    // 权限必须在同一事务内重新读取，避免管理员刚被停用/调岗后仍拿旧 session 越权。
    const liveActor = await tx.user.findUnique({
      where: { id: access.actor.id },
      include: { roleAssignments: { select: { role: true } } },
    });
    if (!liveActor) return { denied: true as const };
    const targetBusinessDate = await resolveGroupBusinessDate(targetGroupId, settings.timezone, now, tx);
    if (effectiveOn > targetBusinessDate)
      return { error: `调动生效日期不能晚于目标小组当地今天 ${targetBusinessDate}`, status: 400 as const };
    return transferUserPosition({
      tx,
      actor: liveActor,
      userId,
      targetGroupId,
      role,
      secondaryRoles: secondaryRoles.value,
      effectiveOn,
      reason,
      receptionHandoffId,
      operatorHandoffId,
      expertHandoffId,
      mode,
      expectedCounts,
    });
  }, { isolationLevel: "Serializable" });
  if ("denied" in result) return authorizationDenied(access.actor, "只能办理当前管理范围内的人员调动");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
