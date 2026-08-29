import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { API_LIMITS } from "../../../../../lib/request-limits";
import { parseFrontlineSecondaryRoles } from "../../../../../lib/role-assignments";
import { authorizationDenied } from "../../../../../lib/security-events";
import { transferableRoles, transferUserPosition, type TransferableRole } from "../../../../../lib/user-position/transfer";
import { requirePersonnelTransferRequest } from "../../_auth";
import { getSystemSettings } from "../../../../../lib/settings";
import { resolveGroupBusinessDate } from "../../../../../lib/business-time";

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
    const targetBusinessDate = await resolveGroupBusinessDate(targetGroupId, settings.timezone, now, tx);
    if (effectiveOn > targetBusinessDate)
      return { error: `调动生效日期不能晚于目标小组当地今天 ${targetBusinessDate}`, status: 400 as const };
    return transferUserPosition({
      tx,
      actor: access.actor,
      userId,
      targetGroupId,
      role,
      secondaryRoles: secondaryRoles.value,
      effectiveOn,
      reason,
      receptionHandoffId,
      operatorHandoffId,
      expertHandoffId,
    });
  }, { isolationLevel: "Serializable" });
  if ("denied" in result) return authorizationDenied(access.actor, "公司管理员只能办理本公司内部的人员调动");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
