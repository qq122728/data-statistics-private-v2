import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "../../../../../lib/db";
import { customerCurrentGroupWhere } from "../../../../../lib/customer-current-group";
import { getActiveLeadGroup, requireLeadRequest } from "../../../../../lib/lead-members";
import { recordAudit } from "../../../../../lib/audit";
import { authorizationDenied } from "../../../../../lib/security-events";
import { hasAssignedRole } from "../../../../../lib/role-access";
import { activeCustomerTrackingWhere } from "../../../../../lib/customer-tracking-archive";

const schema = z.object({
  sourceId: z.string().min(1).max(100),
  targetId: z.string().min(1).max(100),
  reason: z.string().trim().min(4, "交接原因至少填写 4 个字").max(500),
}).strict();

export async function POST(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "交接参数不正确" }, { status: 400 });
  if (parsed.data.sourceId === parsed.data.targetId) return NextResponse.json({ error: "交接双方不能是同一个人" }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const group = await getActiveLeadGroup(access.actor.id, tx);
    if (!group) return { denied: true as const };
    const [source, target] = await Promise.all([
      tx.user.findFirst({ where: { id: parsed.data.sourceId, groupId: group.id, OR: [{ role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } }, { roleAssignments: { some: { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } } } }] }, select: { id: true, name: true } }),
      tx.user.findFirst({ where: { id: parsed.data.targetId, groupId: group.id, active: true }, select: { id: true, name: true, role: true, active: true, roleAssignments: { select: { role: true } } } }),
    ]);
    if (!source || !target) return { denied: true as const };
    const currentGroup = customerCurrentGroupWhere(group.id);
    const activeTracking = activeCustomerTrackingWhere();
    const receptionWhere = { AND: [currentGroup, activeTracking], ownerId: source.id, joinedOn: null, receptionArchivedAt: null };
    const operatorWhere = { AND: [currentGroup, activeTracking], groupOperatorOwnerId: source.id, expertIntroducedOn: null, leftOn: null };
    const expertWhere: Prisma.LeadCustomerWhereInput = { AND: [currentGroup, activeTracking], expertOwnerId: source.id, expertIntroducedOn: { not: null }, leftOn: null, OR: [{ expertWorkflowStage: null }, { expertWorkflowStage: { notIn: ["STALLED", "DECLINED_DEPOSIT"] } }] };
    const [reception, operator, expert, physicalDevices, deviceAccounts] = await Promise.all([
      tx.leadCustomer.count({ where: receptionWhere }),
      tx.leadCustomer.count({ where: operatorWhere }),
      tx.leadCustomer.count({ where: expertWhere }),
      tx.device.count({ where: { groupId: group.id, memberId: source.id, active: true } }),
      tx.deviceAccount.count({ where: { groupId: group.id, ownerId: source.id } }),
    ]);
    if (reception > 0 && !hasAssignedRole(target, "RECEPTION"))
      return { error: "接收人没有接粉权限，不能接收接粉阶段客户", status: 400 as const };
    if (operator > 0 && !hasAssignedRole(target, "GROUP_OPERATOR") && !hasAssignedRole(target, "LEAD"))
      return { error: "接收人没有炒群权限，不能接收炒群阶段客户", status: 400 as const };
    if (expert > 0 && !hasAssignedRole(target, "EXPERT") && !hasAssignedRole(target, "LEAD"))
      return { error: "接收人没有专家权限，不能接收专家阶段客户", status: 400 as const };
    await Promise.all([
      reception ? tx.leadCustomer.updateMany({ where: receptionWhere, data: { ownerId: target.id } }) : Promise.resolve(),
      operator ? tx.leadCustomer.updateMany({ where: operatorWhere, data: { groupOperatorOwnerId: target.id } }) : Promise.resolve(),
      expert ? tx.leadCustomer.updateMany({ where: expertWhere, data: { expertOwnerId: target.id } }) : Promise.resolve(),
      physicalDevices ? tx.device.updateMany({ where: { groupId: group.id, memberId: source.id, active: true }, data: { memberId: target.id } }) : Promise.resolve(),
      deviceAccounts ? tx.deviceAccount.updateMany({ where: { groupId: group.id, ownerId: source.id }, data: { ownerId: target.id } }) : Promise.resolve(),
    ]);
    await recordAudit(tx, {
      actorId: access.actor.id,
      action: "MEMBER_WORK_HANDOVER",
      entityType: "User",
      entityId: source.id,
      summary: { sourceId: source.id, sourceName: source.name, targetId: target.id, targetName: target.name, reason: parsed.data.reason, transferred: { reception, operator, expert, physicalDevices, deviceAccounts } },
    });
    return { sourceId: source.id, targetId: target.id, transferred: { reception, operator, expert, physicalDevices, deviceAccounts } };
  }, { isolationLevel: "Serializable" });
  if ("denied" in result) return authorizationDenied(access.actor, "交接双方必须是本组成员");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
