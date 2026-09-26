import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../../../../../lib/db";
import { recordAudit } from "../../../../../lib/audit";
import { getActiveLeadGroup, requireLeadRequest } from "../../../../../lib/lead-members";
import { authorizationDenied } from "../../../../../lib/security-events";
import { API_LIMITS } from "../../../../../lib/request-limits";

const schema = z.object({
  memberId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  reason: z.string().trim().max(300, "离职备注不能超过 300 个字").optional(),
}).strict();

/**
 * 组长办理离职只收回登录和今后的在岗资格，不移动客户、设备或既有统计。
 * 后续若由同事接手某个客户，应使用客户表里的“当前接粉负责人”，该操作不改原粉归属。
 */
export async function POST(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "离职参数不正确" }, { status: 400 });
  if (parsed.data.memberId === access.actor.id)
    return NextResponse.json({ error: "组长不能在这里办理自己的离职，请由管理员处理" }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const group = await getActiveLeadGroup(access.actor.id, tx);
    if (!group) return { denied: true as const };
    const member = await tx.user.findFirst({
      where: {
        id: parsed.data.memberId,
        groupId: group.id,
        active: true,
        role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
      },
      select: { id: true, name: true },
    });
    if (!member) return { error: "只能办理本组在职组员的离职" as const, status: 403 as const };

    // 不修改 LeadCustomer 的任何负责人：历史归属和未交接的在办客户都原样保留。
    await tx.user.update({ where: { id: member.id }, data: { active: false, mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: member.id } });
    await recordAudit(tx, {
      actorId: access.actor.id,
      action: "MEMBER_OFFBOARDED",
      entityType: "User",
      entityId: member.id,
      summary: {
        reason: parsed.data.reason || null,
        preserved: ["客户负责人", "原接粉归属", "历史添加与业绩", "设备归属"],
      },
    });
    return { member };
  }, { isolationLevel: "Serializable" });

  if ("denied" in result) return authorizationDenied(access.actor, "组长必须归属启用中的小组");
  if ("error" in result) return authorizationDenied(access.actor, result.error ?? "无权办理该成员离职");
  return NextResponse.json({ offboarded: true, member: result.member });
}
