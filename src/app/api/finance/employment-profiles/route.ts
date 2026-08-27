import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireRole } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { parseEmploymentUpdate, parseRecruitmentUpdate } from "../../admin/users/validation";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied, authorizationErrorResponse } from "../../../../lib/security-events";

type RequestBody = { id?: unknown; hireDate?: unknown; recruitmentSource?: unknown; referrerName?: unknown; stageOverride?: unknown; stageOverrideReason?: unknown };

export async function PATCH(request: Request) {
  let actor;
  try { actor = await requireRole("ADMIN", "FINANCE", "HR"); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof AuthorizationError) return authorizationErrorResponse(error, "只有行政、财务或管理员可以补充人员归属");
    throw error;
  }
  const body = await request.json() as RequestBody;
  if (typeof body.id !== "string" || !body.id || body.id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "员工参数不正确" }, { status: 400 });
  const memberId = body.id;
  const parsed = parseRecruitmentUpdate(body as Record<string, unknown>);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const employment = parseEmploymentUpdate(body as Record<string, unknown>);
  if (!employment.success) return NextResponse.json({ error: employment.error }, { status: 400 });
  if (employment.value.stageOverride !== undefined || employment.value.stageOverrideReason !== undefined)
    return authorizationDenied(actor, "这里只能补充入职日期和人员归属，不能修改员工阶段");
  if (parsed.value.recruitmentSource === undefined && employment.value.hireDate === undefined)
    return NextResponse.json({ error: "请填写入职日期或人员归属" }, { status: 400 });
  if (parsed.value.recruitmentSource === "AGENT" && !parsed.value.referrerName) return NextResponse.json({ error: "代理介绍请填写介绍人" }, { status: 400 });
  try {
    const result = await db.$transaction(async (client) => {
      const member = await client.user.findUnique({ where: { id: memberId }, select: { id: true, name: true, hireDate: true, recruitmentSource: true, referrerName: true } });
      if (!member) return { error: "员工不存在", status: 404 as const };
      const updated = await client.user.update({ where: { id: member.id }, data: { ...parsed.value, ...employment.value }, select: { id: true, name: true, hireDate: true, recruitmentSource: true, referrerName: true } });
      if (member.hireDate !== updated.hireDate)
        await recordAudit(client, { actorId: actor.id, action: "USER_EMPLOYMENT_UPDATED", entityType: "User", entityId: member.id, summary: { changedFields: ["hireDate"], name: updated.name, before: { hireDate: member.hireDate }, after: { hireDate: updated.hireDate } } });
      if (member.recruitmentSource !== updated.recruitmentSource || member.referrerName !== updated.referrerName)
        await recordAudit(client, { actorId: actor.id, action: "USER_RECRUITMENT_UPDATED", entityType: "User", entityId: member.id, summary: { changedFields: ["recruitmentSource", "referrerName"], name: updated.name, before: { recruitmentSource: member.recruitmentSource, referrerName: member.referrerName }, after: { recruitmentSource: updated.recruitmentSource, referrerName: updated.referrerName } } });
      return { member: updated };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "提交内容不正确" }, { status: 400 });
    throw error;
  }
}
