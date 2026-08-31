import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { resolveGroupBusinessDate } from "./business-time";
import { getSystemSettings } from "./settings";
import { recordAudit } from "./audit";
import { closeGroupOperatorReceptionAssignmentsForMember } from "./group-operator-collaboration";
import { transferUserPosition, type TransferableRole } from "./user-position/transfer";

const frontlineRoles = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
export type FormerLeadDisposition = "DISABLE" | (typeof frontlineRoles)[number];
type Counts = { reception: number; operator: number; expert: number };

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function activeCounts(tx: Prisma.TransactionClient, userId: string, groupId: string): Promise<Counts> {
  const [reception, operator, expert] = await Promise.all([
    tx.leadCustomer.count({ where: { batch: { groupId }, ownerId: userId, joinedOn: null, receptionArchivedAt: null } }),
    tx.leadCustomer.count({ where: { batch: { groupId }, groupOperatorOwnerId: userId, expertIntroducedOn: null, leftOn: null } }),
    tx.leadCustomer.count({ where: { batch: { groupId }, expertOwnerId: userId, customerOrder: null, OR: [{ expertWorkflowStage: null }, { expertWorkflowStage: { notIn: ["STALLED", "DECLINED_DEPOSIT"] } }] } }),
  ]);
  return { reception, operator, expert };
}

async function disableFormerLead(tx: Prisma.TransactionClient, plan: Awaited<ReturnType<typeof tx.groupLeadChangePlan.findUniqueOrThrow>>, actorId: string) {
  const successorId = plan.newLeadId;
  const [membership, position] = await Promise.all([
    tx.userGroupMembership.findFirst({ where: { userId: plan.formerLeadId, effectiveTo: null }, orderBy: { effectiveFrom: "desc" } }),
    tx.userPosition.findFirst({ where: { userId: plan.formerLeadId, effectiveTo: null }, orderBy: { effectiveFrom: "desc" } }),
  ]);
  if (membership) await tx.userGroupMembership.update({ where: { id: membership.id }, data: { effectiveTo: previousDate(plan.effectiveOn) } });
  if (position) await tx.userPosition.update({ where: { id: position.id }, data: { effectiveTo: previousDate(plan.effectiveOn) } });
  await closeGroupOperatorReceptionAssignmentsForMember({ tx, userId: plan.formerLeadId, actorId, reason: `更换组长：${plan.reason}` });
  await Promise.all([
    tx.user.update({ where: { id: plan.formerLeadId }, data: { active: false } }),
    tx.session.deleteMany({ where: { userId: plan.formerLeadId } }),
    tx.device.updateMany({ where: { groupId: plan.groupId, memberId: plan.formerLeadId }, data: { memberId: null } }),
    tx.leadCustomer.updateMany({ where: { batch: { groupId: plan.groupId }, ownerId: plan.formerLeadId, joinedOn: null, receptionArchivedAt: null }, data: { ownerId: successorId } }),
    tx.leadCustomer.updateMany({ where: { batch: { groupId: plan.groupId }, groupOperatorOwnerId: plan.formerLeadId, expertIntroducedOn: null, leftOn: null }, data: { groupOperatorOwnerId: successorId } }),
    tx.leadCustomer.updateMany({ where: { batch: { groupId: plan.groupId }, expertOwnerId: plan.formerLeadId, customerOrder: null, OR: [{ expertWorkflowStage: null }, { expertWorkflowStage: { notIn: ["STALLED", "DECLINED_DEPOSIT"] } }] }, data: { expertOwnerId: successorId } }),
  ]);
}

export async function executeGroupLeadChangePlan(planId: string) {
  try {
    return await db.$transaction(async (tx) => {
      const plan = await tx.groupLeadChangePlan.findUniqueOrThrow({ where: { id: planId } });
      if (plan.status !== "PENDING") return plan;
      const [former, incoming, actor] = await Promise.all([
        tx.user.findUnique({ where: { id: plan.formerLeadId } }),
        tx.user.findUnique({ where: { id: plan.newLeadId } }),
        tx.user.findUnique({ where: { id: plan.createdById }, include: { roleAssignments: { select: { role: true } }, managedDepartments: { select: { departmentId: true } } } }),
      ]);
      if (!former?.active || former.role !== "LEAD" || former.groupId !== plan.groupId) throw new Error("现任组长资料已经变化，请取消计划后重新操作");
      if (!incoming?.active || !incoming.groupId) throw new Error("新组长账号已经停用或不在小组中");
      if (!actor?.active) throw new Error("创建计划的管理员账号已经停用");

      if (plan.formerDisposition === "DISABLE") await disableFormerLead(tx, plan, actor.id);
      else {
        const result = await transferUserPosition({
          tx, actor, userId: former.id, targetGroupId: plan.formerTargetGroupId ?? plan.groupId,
          role: plan.formerDisposition as TransferableRole, secondaryRoles: [], effectiveOn: plan.effectiveOn,
          reason: plan.reason, receptionHandoffId: plan.newLeadId,
          operatorHandoffId: plan.newLeadId, expertHandoffId: plan.newLeadId,
          handoffTargetWillBeLeadId: plan.newLeadId,
        });
        if (!("ok" in result)) throw new Error("error" in result ? result.error : "原组长后续岗位没有权限执行");
      }

      const promoted = await transferUserPosition({
        tx, actor, userId: incoming.id, targetGroupId: plan.groupId, role: "LEAD", secondaryRoles: [], effectiveOn: plan.effectiveOn,
        reason: plan.reason, receptionHandoffId: plan.newReceptionHandoffId,
        operatorHandoffId: plan.newOperatorHandoffId, expertHandoffId: plan.newExpertHandoffId,
        handoffTargetWillBeLeadId: incoming.groupId === plan.groupId ? incoming.id : null,
      });
      if (!("ok" in promoted)) throw new Error("error" in promoted ? promoted.error : "新组长任命没有权限执行");
      await recordAudit(tx, { actorId: actor.id, action: "GROUP_LEAD_REPLACED", entityType: "TeamGroup", entityId: plan.groupId, summary: { formerLeadId: former.id, newLeadId: incoming.id, effectiveOn: plan.effectiveOn, formerDisposition: plan.formerDisposition, reason: plan.reason } });
      return tx.groupLeadChangePlan.update({ where: { id: plan.id }, data: { status: "APPLIED", appliedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), failureReason: null } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更换组长执行失败";
    await db.groupLeadChangePlan.updateMany({ where: { id: planId, status: "PENDING" }, data: { status: "FAILED", updatedAt: new Date().toISOString(), failureReason: message } });
    throw error;
  }
}

export async function applyDueGroupLeadChangePlans(now = new Date()) {
  const settings = await getSystemSettings();
  const plans = await db.groupLeadChangePlan.findMany({ where: { status: "PENDING" }, orderBy: { effectiveOn: "asc" }, take: 50 });
  for (const plan of plans) {
    const localDate = await resolveGroupBusinessDate(plan.groupId, settings.timezone, now);
    if (plan.effectiveOn <= localDate) {
      try { await executeGroupLeadChangePlan(plan.id); } catch { /* 失败原因已记入计划，不能阻断其他小组。 */ }
    }
  }
}

export async function previewDisabledLead(tx: Prisma.TransactionClient, userId: string, groupId: string) {
  return activeCounts(tx, userId, groupId);
}
