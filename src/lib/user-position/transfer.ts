import type { Prisma, Role } from "@prisma/client";
import { recordAudit } from "../audit";
import { closeGroupOperatorReceptionAssignmentsForMember } from "../group-operator-collaboration";

export const transferableRoles = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
export type TransferableRole = (typeof transferableRoles)[number];

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const abandonedExpertStages = ["STALLED", "DECLINED_DEPOSIT"] as const;

export type TransferUserPositionParams = {
  tx: Prisma.TransactionClient;
  actor: { id: string; role: Role; departmentId: string | null; managementCountryCode: string | null };
  userId: string;
  targetGroupId: string;
  role: TransferableRole;
  secondaryRoles: Role[];
  effectiveOn: string;
  reason: string;
  receptionHandoffId: string | null;
  operatorHandoffId: string | null;
  expertHandoffId: string | null;
};

export type TransferUserPositionResult =
  | { denied: true }
  | { error: string; status: 400 | 409 }
  | { ok: true; customerCount: number; deviceAccountCount: number };

/**
 * 转组转岗只能通过这个函数走（需求文档1.5/1.6）：原子地关闭旧的 UserPosition
 * 有效行、按新岗位开一条新的；LEAD 是职务不是岗位，不写 UserPosition 行，只改
 * User.duty。转岗前必须先交接在办客户，否则拒绝——除非调用方已指定接手人。
 *
 * 专家名下"未成交/停止维护"(STALLED/DECLINED_DEPOSIT)的客户是已放弃跟进的
 * 终态（需求文档8.2/8.3，随时可恢复），不算需要人工指定接手人的"在办"客户，
 * 转岗时自动划给原组组长兜底，不询问理由、不阻挡转岗。
 */
export async function transferUserPosition(params: TransferUserPositionParams): Promise<TransferUserPositionResult> {
  const { tx, actor, userId, targetGroupId, role, secondaryRoles, effectiveOn, reason, receptionHandoffId, operatorHandoffId, expertHandoffId } = params;

  const [member, targetGroup] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true, employeeCode: true, name: true, role: true, groupId: true, active: true,
        group: { select: { departmentId: true, countryCode: true, department: { select: { countryCode: true } } } },
        roleAssignments: { select: { role: true } },
        membershipHistory: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" }, take: 1 },
        positionHistory: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" }, take: 1 },
      },
    }),
    tx.teamGroup.findFirst({ where: { id: targetGroupId, active: true, department: { active: true } }, select: { id: true, name: true, departmentId: true, countryCode: true, department: { select: { countryCode: true } } } }),
  ]);
  if (!member || !member.active || !member.groupId) return { error: "只能调动启用中的小组成员", status: 400 };
  if (!targetGroup) return { error: "目标小组不存在或已经停用", status: 400 };
  if (!transferableRoles.includes(member.role as TransferableRole)) return { error: "只能调动组长、接粉、炒群或专家岗位成员", status: 400 };
  if (actor.role === "COMPANY_MANAGER" && (!actor.departmentId || member.group?.departmentId !== actor.departmentId || targetGroup.departmentId !== actor.departmentId)) {
    return { denied: true };
  }
  if (actor.role === "COMPANY_MANAGER" && actor.managementCountryCode) {
    const memberCountry = member.group?.countryCode || member.group?.department.countryCode;
    const targetCountry = targetGroup.countryCode || targetGroup.department.countryCode;
    if (memberCountry !== actor.managementCountryCode || targetCountry !== actor.managementCountryCode) return { denied: true };
  }
  const currentSecondaryRoles = member.roleAssignments.map((assignment) => assignment.role).filter((assignedRole) => assignedRole !== member.role).sort();
  const targetSecondaryRoles = [...secondaryRoles].sort();
  if (member.groupId === targetGroup.id && member.role === role && currentSecondaryRoles.join(",") === targetSecondaryRoles.join(","))
    return { error: "目标小组和岗位与当前资料相同", status: 400 };
  const currentMembership = member.membershipHistory[0];
  if (currentMembership && effectiveOn <= currentMembership.effectiveFrom)
    return { error: `生效日期必须晚于当前归属开始日期 ${currentMembership.effectiveFrom}`, status: 400 };
  if (role === "LEAD" && await tx.user.findFirst({ where: { groupId: targetGroup.id, role: "LEAD", active: true, id: { not: member.id } }, select: { id: true } }))
    return { error: "目标小组已经有一位启用中的组长", status: 409 };

  const groupChanged = member.groupId !== targetGroup.id;
  const currentRoles = new Set([member.role, ...currentSecondaryRoles]);
  const targetRoles = new Set([role, ...targetSecondaryRoles]);
  const shouldHandoffReception = groupChanged || !targetRoles.has("RECEPTION");
  const shouldHandoffOperator = groupChanged || !targetRoles.has("GROUP_OPERATOR");
  const shouldHandoffExpert = groupChanged || !targetRoles.has("EXPERT");
  const shouldResetCollaboration = groupChanged
    || (currentRoles.has("RECEPTION") && !targetRoles.has("RECEPTION"))
    || (currentRoles.has("GROUP_OPERATOR") && !targetRoles.has("GROUP_OPERATOR"));

  const activeExpertWhere = {
    batch: { groupId: member.groupId },
    expertOwnerId: member.id,
    customerOrder: null,
    OR: [{ expertWorkflowStage: null }, { expertWorkflowStage: { notIn: [...abandonedExpertStages] } }],
  } satisfies Prisma.LeadCustomerWhereInput;
  // STALLED（停止维护）按需求文档8.2定义只能在已开单后发生（markExpertStalled
  // 强制要求有效 customerOrder），customerOrder 不会是 null；DECLINED_DEPOSIT
  // （未成交）则相反，只能在未开单时发生。两个分支不能共用同一个 customerOrder
  // 条件，否则 STALLED 客户永远匹配不上，自动交接给组长会静默失效。
  const abandonedExpertWhere = {
    batch: { groupId: member.groupId },
    expertOwnerId: member.id,
    OR: [
      { expertWorkflowStage: "DECLINED_DEPOSIT" as const, customerOrder: null },
      { expertWorkflowStage: "STALLED" as const },
    ],
  } satisfies Prisma.LeadCustomerWhereInput;

  const [customerCount, receptionCount, operatorCount, expertCount, abandonedExpertCount, deviceCount, deviceAccountCount, handoffMembers, groupLeader] = await Promise.all([
    tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, OR: [{ ownerId: member.id }, { attributionOwnerId: member.id }, { groupOperatorOwnerId: member.id }, { expertOwnerId: member.id }] } }),
    tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, ownerId: member.id, joinedOn: null, receptionArchivedAt: null } }),
    tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, groupOperatorOwnerId: member.id, expertIntroducedOn: null, leftOn: null } }),
    tx.leadCustomer.count({ where: activeExpertWhere }),
    tx.leadCustomer.count({ where: abandonedExpertWhere }),
    tx.device.count({ where: { groupId: member.groupId, memberId: member.id, active: true } }),
    tx.deviceAccount.count({ where: { groupId: member.groupId, ownerId: member.id } }),
    tx.user.findMany({ where: { id: { in: [receptionHandoffId, operatorHandoffId, expertHandoffId].filter((id): id is string => Boolean(id)) }, groupId: member.groupId, active: true }, select: { id: true, role: true, roleAssignments: { select: { role: true } } } }),
    shouldHandoffExpert ? tx.user.findFirst({ where: { groupId: member.groupId, role: "LEAD", active: true, id: { not: member.id } }, select: { id: true } }) : Promise.resolve(null),
  ]);

  const handoffById = new Map(handoffMembers.map((candidate) => [candidate.id, new Set([candidate.role, ...candidate.roleAssignments.map((item) => item.role)])]));
  const validHandoff = (id: string | null, expected: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT") => Boolean(id && (handoffById.get(id)?.has(expected) || handoffById.get(id)?.has("LEAD")));
  if (shouldHandoffReception && receptionCount > 0 && !validHandoff(receptionHandoffId, "RECEPTION")) return { error: `还有 ${receptionCount} 位接粉阶段客户，请选择原小组接粉接收人`, status: 400 };
  if (shouldHandoffOperator && operatorCount > 0 && !validHandoff(operatorHandoffId, "GROUP_OPERATOR")) return { error: `还有 ${operatorCount} 位炒群阶段客户，请选择原小组炒群接收人`, status: 400 };
  if (shouldHandoffExpert && expertCount > 0 && !validHandoff(expertHandoffId, "EXPERT")) return { error: `还有 ${expertCount} 位专家阶段客户，请选择原小组专家接收人`, status: 400 };

  const currentPosition = member.positionHistory[0];
  if (currentPosition) await tx.userPosition.update({ where: { id: currentPosition.id }, data: { effectiveTo: previousDate(effectiveOn) } });
  if (role !== "LEAD") {
    await tx.userPosition.create({ data: { userId: member.id, position: role, secondaryPositions: secondaryRoles.join(",") || null, groupId: targetGroup.id, effectiveFrom: effectiveOn, reason, createdById: actor.id } });
  }
  if (currentMembership) await tx.userGroupMembership.update({ where: { id: currentMembership.id }, data: { effectiveTo: previousDate(effectiveOn) } });
  await tx.userGroupMembership.create({ data: { userId: member.id, groupId: targetGroup.id, role, secondaryRoles: secondaryRoles.join(",") || null, effectiveFrom: effectiveOn, reason, createdById: actor.id } });
  await tx.user.update({
    where: { id: member.id },
    data: {
      groupId: targetGroup.id,
      role,
      duty: role === "LEAD" ? "LEAD" : null,
      roleAssignments: { deleteMany: {}, create: [role, ...secondaryRoles].map((assignedRole) => ({ role: assignedRole })) },
    },
  });
  if (shouldResetCollaboration) {
    await closeGroupOperatorReceptionAssignmentsForMember({
      tx,
      userId: member.id,
      actorId: actor.id,
      reason: `人员转岗：${reason}`,
    });
  }
  await Promise.all([
    tx.session.deleteMany({ where: { userId: member.id } }),
    groupChanged ? tx.device.updateMany({ where: { groupId: member.groupId, memberId: member.id }, data: { memberId: null } }) : Promise.resolve(),
    shouldHandoffReception && receptionHandoffId ? tx.leadCustomer.updateMany({ where: { batch: { groupId: member.groupId }, ownerId: member.id, joinedOn: null, receptionArchivedAt: null }, data: { ownerId: receptionHandoffId } }) : Promise.resolve(),
    shouldHandoffOperator && operatorHandoffId ? tx.leadCustomer.updateMany({ where: { batch: { groupId: member.groupId }, groupOperatorOwnerId: member.id, expertIntroducedOn: null, leftOn: null }, data: { groupOperatorOwnerId: operatorHandoffId } }) : Promise.resolve(),
    shouldHandoffExpert && expertHandoffId ? tx.leadCustomer.updateMany({ where: activeExpertWhere, data: { expertOwnerId: expertHandoffId } }) : Promise.resolve(),
    shouldHandoffExpert && groupLeader ? tx.leadCustomer.updateMany({ where: abandonedExpertWhere, data: { expertOwnerId: groupLeader.id } }) : Promise.resolve(),
  ]);
  await recordAudit(tx, {
    actorId: actor.id,
    action: "MEMBER_TRANSFERRED",
    entityType: "User",
    entityId: member.id,
    summary: {
      employeeCode: member.employeeCode,
      name: member.name,
      effectiveOn,
      reason,
      before: { groupId: member.groupId, role: member.role },
      after: { groupId: targetGroup.id, role, secondaryRoles },
      retainedInOriginalGroup: { customerCount, receptionCount, operatorCount, expertCount, deviceAccountCount },
      handoff: { receptionHandoffId, operatorHandoffId, expertHandoffId },
      autoReassignedAbandonedExpertCount: shouldHandoffExpert && groupLeader ? abandonedExpertCount : 0,
      autoReassignedAbandonedExpertTargetId: shouldHandoffExpert ? groupLeader?.id ?? null : null,
      releasedDeviceCount: groupChanged ? deviceCount : 0,
    },
  });
  return { ok: true, customerCount, deviceAccountCount };
}
