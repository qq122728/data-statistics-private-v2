import { NextResponse } from "next/server";
import { db } from "../../../../../../lib/db";
import { canAppointOrTransferLead, type GroupScope } from "../../../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../../../lib/request-limits";
import { authorizationDenied } from "../../../../../../lib/security-events";
import { transferUserPosition } from "../../../../../../lib/user-position/transfer";
import { executeGroupLeadChangePlan, previewDisabledLead, type FormerLeadDisposition } from "../../../../../../lib/group-lead-change";
import { requireOrgManagerRequest } from "../../../_auth";
import { getSystemSettings } from "../../../../../../lib/settings";
import { resolveGroupBusinessDate } from "../../../../../../lib/business-time";

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
const dispositions = ["DISABLE", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;

async function scopedContext(groupId: string) {
  const group = await db.teamGroup.findFirst({ where: { id: groupId, active: true, department: { active: true } }, select: { id: true, departmentId: true, department: { select: { companyId: true } } } });
  return group ? { group, scope: { id: group.id, departmentId: group.departmentId, companyId: group.department.companyId } satisfies GroupScope } : null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const { groupId } = await params;
  const context = await scopedContext(groupId);
  if (!context) return NextResponse.json({ error: "小组不存在或已经停用" }, { status: 400 });
  if (!canAppointOrTransferLead(access.actor, context.scope)) return authorizationDenied(access.actor, "没有权限查看这个小组的组长更换计划");
  const plan = await db.groupLeadChangePlan.findFirst({ where: { groupId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ plan });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const { groupId } = await params;
  const context = await scopedContext(groupId);
  if (!context) return NextResponse.json({ error: "小组不存在或已经停用" }, { status: 400 });
  if (!canAppointOrTransferLead(access.actor, context.scope)) return authorizationDenied(access.actor, "没有权限取消这个更换计划");
  const now = new Date().toISOString();
  const changed = await db.groupLeadChangePlan.updateMany({ where: { groupId, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: now, updatedAt: now } });
  return NextResponse.json({ cancelled: changed.count });
}

export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const { groupId: targetGroupId } = await params;
  const body = await request.json() as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";
  const effectiveOn = body.effectiveOn;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const disposition = (typeof body.formerDisposition === "string" ? body.formerDisposition : "DISABLE") as FormerLeadDisposition;
  if (!targetGroupId || targetGroupId.length > API_LIMITS.identifierCharacters || !userId || userId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "小组或人员参数不正确" }, { status: 400 });
  if (!isDate(effectiveOn)) return NextResponse.json({ error: "请选择正确的生效日期" }, { status: 400 });
  if (reason.length < 4 || reason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "更换原因需要填写 4 到 500 个字" }, { status: 400 });
  if (!dispositions.includes(disposition)) return NextResponse.json({ error: "原组长后续处理不正确" }, { status: 400 });
  const settings = await getSystemSettings();
  const now = new Date();

  const created = await db.$transaction(async (tx) => {
    const [targetGroup, incoming, former, pending] = await Promise.all([
      tx.teamGroup.findFirst({ where: { id: targetGroupId, active: true, department: { active: true } }, select: { id: true, departmentId: true, department: { select: { companyId: true } } } }),
      tx.user.findUnique({ where: { id: userId }, select: { id: true, groupId: true, group: { select: { departmentId: true, department: { select: { companyId: true } } } } } }),
      tx.user.findFirst({ where: { groupId: targetGroupId, role: "LEAD", active: true }, select: { id: true } }),
      tx.groupLeadChangePlan.findFirst({ where: { groupId: targetGroupId, status: "PENDING" }, select: { id: true } }),
    ]);
    if (!targetGroup || !incoming?.groupId || !incoming.group) return { error: "目标小组或候选人员不存在", status: 400 as const };
    const targetScope: GroupScope = { id: targetGroup.id, departmentId: targetGroup.departmentId, companyId: targetGroup.department.companyId };
    const sourceScope: GroupScope = { id: incoming.groupId, departmentId: incoming.group.departmentId, companyId: incoming.group.department.companyId };
    if (!canAppointOrTransferLead(access.actor, targetScope) || !canAppointOrTransferLead(access.actor, sourceScope)) return { denied: true as const };
    const localToday = await resolveGroupBusinessDate(targetGroup.id, settings.timezone, now, tx);
    if (!former) {
      if (effectiveOn > localToday) return { error: "空缺小组请在生效当天任命；未来计划只适用于已有组长的小组", status: 400 as const };
      const incomingCounts = await previewDisabledLead(tx, incoming.id, incoming.groupId);
      const sourceLead = incoming.groupId === targetGroupId ? incoming : await tx.user.findFirst({ where: { groupId: incoming.groupId, role: "LEAD", active: true, id: { not: incoming.id } }, select: { id: true } });
      if ((incomingCounts.reception || incomingCounts.operator || incomingCounts.expert) && !sourceLead) return { error: "新组长原小组没有可自动接管客户的组长，请先补齐原小组组长", status: 400 as const };
      const receiverId = sourceLead?.id ?? incoming.id;
      return transferUserPosition({ tx, actor: access.actor, userId, targetGroupId, role: "LEAD", secondaryRoles: [], effectiveOn, reason, receptionHandoffId: receiverId, operatorHandoffId: receiverId, expertHandoffId: receiverId, handoffTargetWillBeLeadId: incoming.groupId === targetGroupId ? incoming.id : null });
    }
    if (former.id === userId) return { error: "新组长不能还是当前组长", status: 400 as const };
    if (pending) return { error: "这个小组已经有待生效计划，请先取消原计划", status: 409 as const };
    const targetForFormer = typeof body.formerTargetGroupId === "string" && body.formerTargetGroupId ? body.formerTargetGroupId : targetGroupId;
    if (disposition !== "DISABLE") {
      const formerTarget = await tx.teamGroup.findFirst({ where: { id: targetForFormer, active: true }, select: { id: true, departmentId: true, department: { select: { companyId: true } } } });
      if (!formerTarget || !canAppointOrTransferLead(access.actor, { id: formerTarget.id, departmentId: formerTarget.departmentId, companyId: formerTarget.department.companyId })) return { denied: true as const };
    }
    const [formerCounts, incomingCounts, incomingSourceLead] = await Promise.all([
      previewDisabledLead(tx, former.id, targetGroupId),
      previewDisabledLead(tx, incoming.id, incoming.groupId),
      incoming.groupId === targetGroupId ? Promise.resolve({ id: incoming.id }) : tx.user.findFirst({ where: { groupId: incoming.groupId, role: "LEAD", active: true, id: { not: incoming.id } }, select: { id: true } }),
    ]);
    if ((incomingCounts.reception || incomingCounts.operator || incomingCounts.expert) && !incomingSourceLead) return { error: "新组长原小组没有可自动接管客户的组长，请先补齐原小组组长", status: 400 as const };
    const incomingReceiverId = incomingSourceLead?.id ?? incoming.id;

    const plan = await tx.groupLeadChangePlan.create({ data: {
      groupId: targetGroupId, formerLeadId: former.id, newLeadId: userId, effectiveOn,
      formerDisposition: disposition, formerTargetGroupId: disposition === "DISABLE" ? null : targetForFormer,
      formerReceptionHandoffId: incoming.id, formerOperatorHandoffId: incoming.id, formerExpertHandoffId: incoming.id,
      newReceptionHandoffId: incomingReceiverId, newOperatorHandoffId: incomingReceiverId, newExpertHandoffId: incomingReceiverId,
      reason, createdById: access.actor.id, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    } });
    return { ok: true as const, plan, localToday, formerCounts };
  }, { isolationLevel: "Serializable" });

  if ("denied" in created) return authorizationDenied(access.actor, "没有权限更换这个小组的组长");
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: created.status === 409 ? 409 : 400 });
  if (!("plan" in created)) return NextResponse.json(created);
  if (created.plan.effectiveOn <= created.localToday) {
    try { const applied = await executeGroupLeadChangePlan(created.plan.id); return NextResponse.json({ ok: true, plan: applied }); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "更换组长失败" }, { status: 400 }); }
  }
  return NextResponse.json({ ok: true, plan: created.plan, scheduled: true, formerCounts: created.formerCounts });
}
