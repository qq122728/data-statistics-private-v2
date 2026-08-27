import { NextResponse } from "next/server";
import { recordAudit } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { API_LIMITS } from "../../../../../lib/request-limits";
import { parseFrontlineSecondaryRoles } from "../../../../../lib/role-assignments";
import { authorizationDenied } from "../../../../../lib/security-events";
import { requirePersonnelTransferRequest } from "../../_auth";

const transferableRoles = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
type TransferableRole = (typeof transferableRoles)[number];

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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
  if (effectiveOn > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "调动生效日期不能晚于今天" }, { status: 400 });
  if (reason.length < 4 || reason.length > API_LIMITS.accountReasonCharacters)
    return NextResponse.json({ error: "调动原因需要填写 4 到 500 个字" }, { status: 400 });
  const secondaryRoles = parseFrontlineSecondaryRoles(role, body.secondaryRoles);
  if (!secondaryRoles.success) return NextResponse.json({ error: secondaryRoles.error }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const [member, targetGroup] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true, employeeCode: true, name: true, role: true, groupId: true, active: true,
          group: { select: { departmentId: true, countryCode: true, department: { select: { countryCode: true } } } },
          roleAssignments: { select: { role: true } },
          membershipHistory: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" }, take: 1 },
        },
      }),
      tx.teamGroup.findFirst({ where: { id: targetGroupId, active: true, department: { active: true } }, select: { id: true, name: true, departmentId: true, countryCode: true, department: { select: { countryCode: true } } } }),
    ]);
    if (!member || !member.active || !member.groupId) return { error: "只能调动启用中的小组成员", status: 400 as const };
    if (!targetGroup) return { error: "目标小组不存在或已经停用", status: 400 as const };
    if (!transferableRoles.includes(member.role as TransferableRole)) return { error: "只能调动组长、接粉、炒群或专家岗位成员", status: 400 as const };
    if (access.actor.role === "COMPANY_MANAGER" && (!access.actor.departmentId || member.group?.departmentId !== access.actor.departmentId || targetGroup.departmentId !== access.actor.departmentId)) {
      return { denied: true as const };
    }
    if (access.actor.role === "COMPANY_MANAGER" && access.actor.managementCountryCode) {
      const memberCountry = member.group?.countryCode || member.group?.department.countryCode;
      const targetCountry = targetGroup.countryCode || targetGroup.department.countryCode;
      if (memberCountry !== access.actor.managementCountryCode || targetCountry !== access.actor.managementCountryCode) return { denied: true as const };
    }
    const currentSecondaryRoles = member.roleAssignments.map((assignment) => assignment.role).filter((assignedRole) => assignedRole !== member.role).sort();
    const targetSecondaryRoles = [...secondaryRoles.value].sort();
    if (member.groupId === targetGroup.id && member.role === role && currentSecondaryRoles.join(",") === targetSecondaryRoles.join(","))
      return { error: "目标小组和岗位与当前资料相同", status: 400 as const };
    const currentMembership = member.membershipHistory[0];
    if (currentMembership && effectiveOn <= currentMembership.effectiveFrom)
      return { error: `生效日期必须晚于当前归属开始日期 ${currentMembership.effectiveFrom}`, status: 400 as const };
    if (role === "LEAD" && await tx.user.findFirst({ where: { groupId: targetGroup.id, role: "LEAD", active: true, id: { not: member.id } }, select: { id: true } }))
      return { error: "目标小组已经有一位启用中的组长", status: 409 as const };

    const groupChanged = member.groupId !== targetGroup.id;
    const currentRoles = new Set([member.role, ...currentSecondaryRoles]);
    const targetRoles = new Set([role, ...targetSecondaryRoles]);
    const shouldHandoffReception = groupChanged || !targetRoles.has("RECEPTION");
    const shouldHandoffOperator = groupChanged || !targetRoles.has("GROUP_OPERATOR");
    const shouldHandoffExpert = groupChanged || !targetRoles.has("EXPERT");
    const shouldResetCollaboration = groupChanged
      || (currentRoles.has("RECEPTION") && !targetRoles.has("RECEPTION"))
      || (currentRoles.has("GROUP_OPERATOR") && !targetRoles.has("GROUP_OPERATOR"));

    const [customerCount, receptionCount, operatorCount, expertCount, deviceCount, deviceAccountCount, handoffMembers] = await Promise.all([
      tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, OR: [{ ownerId: member.id }, { attributionOwnerId: member.id }, { groupOperatorOwnerId: member.id }, { expertOwnerId: member.id }] } }),
      tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, ownerId: member.id, joinedOn: null, receptionArchivedAt: null } }),
      tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, groupOperatorOwnerId: member.id, expertIntroducedOn: null, leftOn: null } }),
      tx.leadCustomer.count({ where: { batch: { groupId: member.groupId }, expertOwnerId: member.id, customerOrder: null } }),
      tx.device.count({ where: { groupId: member.groupId, memberId: member.id, active: true } }),
      tx.deviceAccount.count({ where: { groupId: member.groupId, ownerId: member.id } }),
      tx.user.findMany({ where: { id: { in: [receptionHandoffId, operatorHandoffId, expertHandoffId].filter((id): id is string => Boolean(id)) }, groupId: member.groupId, active: true }, select: { id: true, role: true, roleAssignments: { select: { role: true } } } }),
    ]);

    const handoffById = new Map(handoffMembers.map((candidate) => [candidate.id, new Set([candidate.role, ...candidate.roleAssignments.map((item) => item.role)])]));
    const validHandoff = (id: string | null, expected: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT") => Boolean(id && (handoffById.get(id)?.has(expected) || handoffById.get(id)?.has("LEAD")));
    if (shouldHandoffReception && receptionCount > 0 && !validHandoff(receptionHandoffId, "RECEPTION")) return { error: `还有 ${receptionCount} 位接粉阶段客户，请选择原小组接粉接收人`, status: 400 as const };
    if (shouldHandoffOperator && operatorCount > 0 && !validHandoff(operatorHandoffId, "GROUP_OPERATOR")) return { error: `还有 ${operatorCount} 位炒群阶段客户，请选择原小组炒群接收人`, status: 400 as const };
    if (shouldHandoffExpert && expertCount > 0 && !validHandoff(expertHandoffId, "EXPERT")) return { error: `还有 ${expertCount} 位专家阶段客户，请选择原小组专家接收人`, status: 400 as const };

    if (currentMembership) await tx.userGroupMembership.update({ where: { id: currentMembership.id }, data: { effectiveTo: previousDate(effectiveOn) } });
    await tx.userGroupMembership.create({ data: { userId: member.id, groupId: targetGroup.id, role, secondaryRoles: secondaryRoles.value.join(",") || null, effectiveFrom: effectiveOn, reason, createdById: access.actor.id } });
    await tx.user.update({
      where: { id: member.id },
      data: {
        groupId: targetGroup.id,
        role,
        roleAssignments: { deleteMany: {}, create: [role, ...secondaryRoles.value].map((assignedRole) => ({ role: assignedRole })) },
      },
    });
    await Promise.all([
      tx.session.deleteMany({ where: { userId: member.id } }),
      shouldResetCollaboration ? tx.groupOperatorReception.deleteMany({ where: { OR: [{ groupOperatorId: member.id }, { receptionistId: member.id }] } }) : Promise.resolve(),
      groupChanged ? tx.device.updateMany({ where: { groupId: member.groupId, memberId: member.id }, data: { memberId: null } }) : Promise.resolve(),
      shouldHandoffReception && receptionHandoffId ? tx.leadCustomer.updateMany({ where: { batch: { groupId: member.groupId }, ownerId: member.id, joinedOn: null, receptionArchivedAt: null }, data: { ownerId: receptionHandoffId } }) : Promise.resolve(),
      shouldHandoffOperator && operatorHandoffId ? tx.leadCustomer.updateMany({ where: { batch: { groupId: member.groupId }, groupOperatorOwnerId: member.id, expertIntroducedOn: null, leftOn: null }, data: { groupOperatorOwnerId: operatorHandoffId } }) : Promise.resolve(),
      shouldHandoffExpert && expertHandoffId ? tx.leadCustomer.updateMany({ where: { batch: { groupId: member.groupId }, expertOwnerId: member.id, customerOrder: null }, data: { expertOwnerId: expertHandoffId } }) : Promise.resolve(),
    ]);
    await recordAudit(tx, {
      actorId: access.actor.id,
      action: "MEMBER_TRANSFERRED",
      entityType: "User",
      entityId: member.id,
      summary: {
        employeeCode: member.employeeCode,
        name: member.name,
        effectiveOn,
        reason,
        before: { groupId: member.groupId, role: member.role },
        after: { groupId: targetGroup.id, role, secondaryRoles: secondaryRoles.value },
        retainedInOriginalGroup: { customerCount, receptionCount, operatorCount, expertCount, deviceAccountCount },
        handoff: { receptionHandoffId, operatorHandoffId, expertHandoffId },
        releasedDeviceCount: groupChanged ? deviceCount : 0,
      },
    });
    return { ok: true as const, customerCount, deviceAccountCount };
  }, { isolationLevel: "Serializable" });
  if ("denied" in result) return authorizationDenied(access.actor, "公司管理员只能办理本公司内部的人员调动");
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
