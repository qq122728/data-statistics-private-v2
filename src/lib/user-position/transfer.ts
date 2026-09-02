import type { Duty, Prisma, Role } from "@prisma/client";
import { recordAudit } from "../audit";
import { customerCurrentGroupWhere } from "../customer-current-group";
import { closeGroupOperatorReceptionAssignmentsForMember } from "../group-operator-collaboration";
import { canManageDepartment } from "../managed-department-scope";
import { activeCustomerTrackingWhere } from "../customer-tracking-archive";

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
  actor: {
    id: string; role: Role; duty: Duty | null; active: boolean; groupId: string | null;
    departmentId: string | null; companyId: string | null; managementCountryCode: string | null;
    roleAssignments?: Array<{ role: Role }>;
    managedDepartments?: Array<{ departmentId: string }>;
  };
  userId: string;
  targetGroupId: string;
  role: TransferableRole;
  secondaryRoles: Role[];
  effectiveOn: string;
  reason: string;
  receptionHandoffId: string | null;
  operatorHandoffId: string | null;
  expertHandoffId: string | null;
  mode?: "preview" | "confirm";
  expectedCounts?: { reception: number; operator: number; expert: number } | null;
  /** 更换组长事务中，允许被本事务先行卸任的现任组长。 */
  replaceLeadId?: string | null;
  /** 更换组长事务中，这个人会在同一事务稍后成为组长，可提前作为自动接收人。 */
  handoffTargetWillBeLeadId?: string | null;
};

export type TransferUserPositionResult =
  | { denied: true }
  | { error: string; status: 400 | 409 }
  | { ok: true; preview: true; groupChanged: boolean; counts: { reception: number; operator: number; expert: number }; customerCount: number; movingCustomerCount: number; deviceCount: number; deviceAccountCount: number; conflicts: string[] }
  | { ok: true; groupChanged: boolean; customerCount: number; movingCustomerCount: number; deviceCount: number; deviceAccountCount: number };

/**
 * 转组转岗只能通过这个函数走（需求文档1.5/1.6）：原子地关闭旧的 UserPosition
 * 有效行、按新岗位开一条新的；LEAD 是职务不是岗位，不写 UserPosition 行，只改
 * User.duty。同组转岗且失去原岗位时，在办客户必须交接；跨组时在办客户、
 * 实体设备和设备账号跟着本人去新组，来源批次和历史统计归属永远不改。
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
        id: true, employeeCode: true, name: true, role: true, groupId: true, active: true, canViewAllGroupCustomers: true,
        group: { select: { departmentId: true, countryCode: true, department: { select: { companyId: true, countryCode: true } } } },
        roleAssignments: { select: { role: true } },
        membershipHistory: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" }, take: 1 },
        positionHistory: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" }, take: 1 },
      },
    }),
    tx.teamGroup.findFirst({ where: { id: targetGroupId, active: true, department: { active: true } }, select: { id: true, name: true, departmentId: true, countryCode: true, department: { select: { companyId: true, countryCode: true } } } }),
  ]);
  if (!member || !member.active || !member.groupId) return { error: "只能调动启用中的小组成员", status: 400 };
  if (!targetGroup) return { error: "目标小组不存在或已经停用", status: 400 };
  if (!transferableRoles.includes(member.role as TransferableRole)) return { error: "只能调动组长、接粉、炒群或专家岗位成员", status: 400 };
  if (!actor.active) return { denied: true };
  const sourceCompanyId = member.group?.department.companyId ?? null;
  const targetCompanyId = targetGroup.department.companyId;
  if (actor.role !== "ADMIN" && actor.duty !== "HQ_MANAGER") {
    if (actor.duty === "COMPANY_MANAGER") {
      if (!actor.companyId || sourceCompanyId !== actor.companyId || targetCompanyId !== actor.companyId) return { denied: true };
    } else if (actor.duty === "DEPARTMENT_MANAGER") {
      if (!member.group?.departmentId || !canManageDepartment(actor, member.group.departmentId) || !canManageDepartment(actor, targetGroup.departmentId)) return { denied: true };
    } else if (actor.role === "LEAD" || actor.duty === "LEAD") {
      if (!actor.groupId || member.groupId !== actor.groupId || targetGroup.id !== actor.groupId) return { denied: true };
    } else if (actor.role === "COMPANY_MANAGER" && actor.departmentId) {
      // 兼容迁移前的老管理员账号；新账号一律使用 Duty + companyId/departmentId。
      if (member.group?.departmentId !== actor.departmentId || targetGroup.departmentId !== actor.departmentId) return { denied: true };
    } else return { denied: true };
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
  const conflictingLead = role === "LEAD" ? await tx.user.findFirst({
    where: { groupId: targetGroup.id, role: "LEAD", active: true, id: { not: member.id } },
    select: { id: true },
  }) : null;
  if (conflictingLead && conflictingLead.id !== params.replaceLeadId)
    return { error: "目标小组已经有一位启用中的组长", status: 409 };

  const groupChanged = member.groupId !== targetGroup.id;
  const currentRoles = new Set([member.role, ...currentSecondaryRoles]);
  const targetRoles = new Set([role, ...targetSecondaryRoles]);
  const shouldHandoffReception = !targetRoles.has("RECEPTION");
  const shouldHandoffOperator = !targetRoles.has("GROUP_OPERATOR");
  const shouldHandoffExpert = !targetRoles.has("EXPERT");
  const shouldResetCollaboration = groupChanged
    || (currentRoles.has("RECEPTION") && !targetRoles.has("RECEPTION"))
    || (currentRoles.has("GROUP_OPERATOR") && !targetRoles.has("GROUP_OPERATOR"));

  const currentGroupWhere = customerCurrentGroupWhere(member.groupId);
  const activeTracking = activeCustomerTrackingWhere();
  const receptionCustomerWhere = {
    AND: [currentGroupWhere, activeTracking],
    ownerId: member.id,
    joinedOn: null,
    receptionArchivedAt: null,
  } satisfies Prisma.LeadCustomerWhereInput;
  const operatorCustomerWhere = {
    AND: [currentGroupWhere, activeTracking],
    groupOperatorOwnerId: member.id,
    expertIntroducedOn: null,
    leftOn: null,
  } satisfies Prisma.LeadCustomerWhereInput;
  const activeExpertWhere = {
    AND: [currentGroupWhere, activeTracking],
    expertOwnerId: member.id,
    expertIntroducedOn: { not: null },
    leftOn: null,
    OR: [{ expertWorkflowStage: null }, { expertWorkflowStage: { notIn: [...abandonedExpertStages] } }],
  } satisfies Prisma.LeadCustomerWhereInput;
  // STALLED（停止维护）按需求文档8.2定义只能在已开单后发生（markExpertStalled
  // 强制要求有效 customerOrder），customerOrder 不会是 null；DECLINED_DEPOSIT
  // （未成交）则相反，只能在未开单时发生。两个分支不能共用同一个 customerOrder
  // 条件，否则 STALLED 客户永远匹配不上，自动交接给组长会静默失效。
  const abandonedExpertWhere = {
    AND: [currentGroupWhere, activeTracking],
    expertOwnerId: member.id,
    OR: [
      { expertWorkflowStage: "DECLINED_DEPOSIT" as const, customerOrder: null },
      { expertWorkflowStage: "STALLED" as const },
    ],
  } satisfies Prisma.LeadCustomerWhereInput;

  // 跨组时只搬“此刻由本人负责、且到新组仍保留对应岗位”的在办客户。
  // ownerId/attributionOwnerId 会永久保留历史经手关系，不能单独当作当前责任人依据。
  const movingResponsibilityWhere: Prisma.LeadCustomerWhereInput[] = [];
  if (targetRoles.has("RECEPTION")) movingResponsibilityWhere.push({ ownerId: member.id, joinedOn: null, receptionArchivedAt: null });
  if (targetRoles.has("GROUP_OPERATOR")) movingResponsibilityWhere.push({ groupOperatorOwnerId: member.id, expertIntroducedOn: null, leftOn: null });
  if (targetRoles.has("EXPERT")) movingResponsibilityWhere.push({ expertOwnerId: member.id, expertIntroducedOn: { not: null }, leftOn: null, OR: [{ expertWorkflowStage: null }, { expertWorkflowStage: { notIn: [...abandonedExpertStages] } }] });
  const movingCustomerWhere = {
    AND: [
      currentGroupWhere,
      activeTracking,
      { OR: movingResponsibilityWhere.length ? movingResponsibilityWhere : [{ id: "__no_current_responsibility__" }] },
    ],
  } satisfies Prisma.LeadCustomerWhereInput;

  const [customerCount, movingCustomerCount, receptionCount, operatorCount, expertCount, abandonedExpertCount, devices, deviceAccounts, handoffMembers, groupLeader] = await Promise.all([
    tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, OR: [{ ownerId: member.id }, { attributionOwnerId: member.id }, { groupOperatorOwnerId: member.id }, { expertOwnerId: member.id }] } }),
    groupChanged ? tx.leadCustomer.count({ where: movingCustomerWhere }) : Promise.resolve(0),
    tx.leadCustomer.count({ where: receptionCustomerWhere }),
    tx.leadCustomer.count({ where: operatorCustomerWhere }),
    tx.leadCustomer.count({ where: activeExpertWhere }),
    tx.leadCustomer.count({ where: abandonedExpertWhere }),
    // 只有正在使用的实体设备才是“当前工作”。已停用设备是历史记录，
    // 人员跨组时必须留在原组，否则旧设备的归属历史会被篡改。
    tx.device.findMany({ where: { groupId: member.groupId, memberId: member.id, active: true }, select: { id: true, code: true } }),
    tx.deviceAccount.findMany({ where: { groupId: member.groupId, ownerId: member.id }, select: { id: true, accountNumber: true } }),
    tx.user.findMany({ where: { id: { in: [receptionHandoffId, operatorHandoffId, expertHandoffId].filter((id): id is string => Boolean(id)) }, groupId: member.groupId, active: true }, select: { id: true, role: true, roleAssignments: { select: { role: true } } } }),
    (groupChanged || shouldHandoffExpert) ? tx.user.findFirst({ where: { groupId: member.groupId, role: "LEAD", active: true, id: { not: member.id } }, select: { id: true } }) : Promise.resolve(null),
  ]);

  const handoffById = new Map(handoffMembers.map((candidate) => [candidate.id, new Set([candidate.role, ...candidate.roleAssignments.map((item) => item.role)])]));
  const counts = {
    reception: shouldHandoffReception ? receptionCount : 0,
    operator: shouldHandoffOperator ? operatorCount : 0,
    expert: shouldHandoffExpert ? expertCount : 0,
  };
  const [deviceConflicts, accountConflicts] = groupChanged ? await Promise.all([
    devices.length ? tx.device.findMany({ where: { groupId: targetGroup.id, code: { in: devices.map((item) => item.code) } }, select: { code: true } }) : Promise.resolve([]),
    deviceAccounts.length ? tx.deviceAccount.findMany({ where: { groupId: targetGroup.id, accountNumber: { in: deviceAccounts.map((item) => item.accountNumber) } }, select: { accountNumber: true } }) : Promise.resolve([]),
  ]) : [[], []];
  const conflicts = [
    ...deviceConflicts.map((item) => `目标组已有设备号 ${item.code}`),
    ...accountConflicts.map((item) => `目标组已有设备账号 ${item.accountNumber}`),
  ];
  if (params.mode === "preview") return { ok: true, preview: true, groupChanged, counts, customerCount, movingCustomerCount, deviceCount: devices.length, deviceAccountCount: deviceAccounts.length, conflicts };
  if (conflicts.length) return { error: `设备资料存在冲突：${conflicts.join("；")}`, status: 409 };
  if (params.expectedCounts && (
    params.expectedCounts.reception !== counts.reception
    || params.expectedCounts.operator !== counts.operator
    || params.expectedCounts.expert !== counts.expert
  )) return { error: "在办客户数量已经变化，请重新预览后再确认调动", status: 409 };
  const validHandoff = (id: string | null, expected: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT") => Boolean(id && (
    id === params.handoffTargetWillBeLeadId
    || handoffById.get(id)?.has(expected)
    || handoffById.get(id)?.has("LEAD")
  ));
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
      ...(groupChanged ? { canViewAllGroupCustomers: false } : {}),
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
    groupChanged ? tx.leadCustomer.updateMany({ where: movingCustomerWhere, data: { currentGroupId: targetGroup.id } }) : Promise.resolve(),
    groupChanged ? tx.device.updateMany({ where: { groupId: member.groupId, memberId: member.id, active: true }, data: { groupId: targetGroup.id } }) : Promise.resolve(),
    groupChanged ? tx.deviceAccount.updateMany({ where: { groupId: member.groupId, ownerId: member.id }, data: { groupId: targetGroup.id } }) : Promise.resolve(),
    shouldHandoffReception && receptionHandoffId ? tx.leadCustomer.updateMany({ where: receptionCustomerWhere, data: { ownerId: receptionHandoffId } }) : Promise.resolve(),
    shouldHandoffOperator && operatorHandoffId ? tx.leadCustomer.updateMany({ where: operatorCustomerWhere, data: { groupOperatorOwnerId: operatorHandoffId } }) : Promise.resolve(),
    shouldHandoffExpert && expertHandoffId ? tx.leadCustomer.updateMany({ where: activeExpertWhere, data: { expertOwnerId: expertHandoffId } }) : Promise.resolve(),
    (groupChanged || shouldHandoffExpert) && groupLeader ? tx.leadCustomer.updateMany({ where: abandonedExpertWhere, data: { expertOwnerId: groupLeader.id } }) : Promise.resolve(),
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
      before: { groupId: member.groupId, role: member.role, canViewAllGroupCustomers: member.canViewAllGroupCustomers },
      after: { groupId: targetGroup.id, role, secondaryRoles, canViewAllGroupCustomers: groupChanged ? false : member.canViewAllGroupCustomers },
      retainedInOriginalGroup: { historicalCustomerAndStatAttribution: true, sourceCustomerCount: customerCount },
      movedToTargetGroup: { movingCustomerCount, deviceCount: devices.length, deviceAccountCount: deviceAccounts.length },
      handoff: { receptionHandoffId, operatorHandoffId, expertHandoffId },
      autoReassignedAbandonedExpertCount: (groupChanged || shouldHandoffExpert) && groupLeader ? abandonedExpertCount : 0,
      autoReassignedAbandonedExpertTargetId: groupChanged || shouldHandoffExpert ? groupLeader?.id ?? null : null,
      releasedDeviceCount: 0,
    },
  });
  return { ok: true, groupChanged, customerCount, movingCustomerCount, deviceCount: devices.length, deviceAccountCount: deviceAccounts.length };
}
