import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../../lib/auth";
import { db, getOrCreateSourceBatch } from "../../../../../lib/db";
import { recordAudit } from "../../../../../lib/audit";
import { isFrontlineGroupMember } from "../../../../../lib/role-access";
import { API_LIMITS } from "../../../../../lib/request-limits";
import { authorizationDenied } from "../../../../../lib/security-events";
import { leadCurrentGroupId } from "../../../../../lib/customer-current-group";
import { statisticsDate } from "../../../../../lib/statistics-date";
import { incrementHistoricalCustomerDailyStat } from "../../../../../lib/daily-stats";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assignGroupOperator"), userId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setDeviceCode"), code: z.string().trim().max(100, "设备号不能超过 100 个字") }),
  z.object({ action: z.literal("assignExpert"), userId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setChannel"), channelId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setOwner"), userId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setRegistration"), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("setLeave"), leaveType: z.enum(["NORMAL", "ABNORMAL"]), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ leadId: string }> }) {
  let sessionUser;
  try { sessionUser = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!sessionUser.active || !sessionUser.groupId || !isFrontlineGroupMember(sessionUser))
    return authorizationDenied(sessionUser, "只有本组在职组员可以修改共享客户表");

  try {
    const input = updateSchema.parse(await request.json());
    const { leadId } = await params;
    if (leadId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "客户参数过长" }, { status: 400 });
    const result = await db.$transaction(async (transaction) => {
      const actor = await transaction.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } },
      });
      const lead = await transaction.leadCustomer.findUnique({
        where: { id: leadId },
        include: { batch: { select: { groupId: true, channelId: true, sourceDate: true } } },
      });
      if (!actor?.active || !actor.groupId || !lead || leadCurrentGroupId(lead) !== actor.groupId)
        return { status: 404 as const, error: "客户不存在或已不在本组" };
      const update: Record<string, unknown> = {};
      let activity: { kind: "DEVICE_ASSIGNED" | "EXPERT_INTRODUCED" | "REGISTERED" | "LEFT_GROUP" | "PLAN_UPDATED"; note: string; occurredOn: string } | null = null;
      const today = statisticsDate();

      if (input.action === "assignGroupOperator") {
        const target = await transaction.user.findFirst({ where: { id: input.userId, groupId: actor.groupId, active: true }, select: { id: true, name: true } });
        if (!target) return { status: 400 as const, error: "只能选择本组在职组员" };
        update.groupOperatorOwnerId = target.id;
        activity = { kind: "PLAN_UPDATED", note: `炒群负责人调整为 ${target.name}`, occurredOn: lead.joinedOn ?? lead.batch.sourceDate };
      } else if (input.action === "setDeviceCode") {
        if (!input.code) {
          update.deviceId = null;
          activity = { kind: "DEVICE_ASSIGNED", note: "设备号已清空", occurredOn: lead.joinedOn ?? lead.batch.sourceDate };
        } else {
          const device = await transaction.device.upsert({
            where: { groupId_code: { groupId: actor.groupId, code: input.code } },
            update: {},
            create: { groupId: actor.groupId, code: input.code, memberId: actor.id },
            select: { id: true, code: true },
          });
          update.deviceId = device.id;
          activity = { kind: "DEVICE_ASSIGNED", note: `设备号调整为 ${device.code}`, occurredOn: lead.joinedOn ?? lead.batch.sourceDate };
        }
      } else if (input.action === "assignExpert") {
        const target = await transaction.user.findFirst({
          where: { id: input.userId, groupId: actor.groupId, active: true, OR: [{ role: { in: ["LEAD", "EXPERT"] } }, { roleAssignments: { some: { role: "EXPERT" } } }] },
          select: { id: true, name: true },
        });
        if (!target) return { status: 400 as const, error: "专家负责人只能选择本组组长或在职专家" };
        update.expertOwnerId = target.id;
        update.expertIntroducedOn = lead.expertIntroducedOn ?? (lead.isHistoricalRecord ? today : lead.joinedOn ?? lead.batch.sourceDate);
        update.expertWorkflowStage = lead.expertWorkflowStage ?? "QUEUED";
        update.expertStageChangedAt = new Date();
        activity = { kind: "EXPERT_INTRODUCED", note: `专家负责人调整为 ${target.name}`, occurredOn: lead.expertIntroducedOn ?? (lead.isHistoricalRecord ? today : lead.joinedOn ?? lead.batch.sourceDate) };
      } else if (input.action === "setChannel") {
        const channel = await transaction.channel.findUnique({ where: { id_groupId: { id: input.channelId, groupId: actor.groupId } }, select: { id: true, name: true, active: true } });
        if (!channel?.active) return { status: 400 as const, error: "来源渠道不存在或已停用" };
        const batch = await getOrCreateSourceBatch({ groupId: actor.groupId, channelId: channel.id, sourceDate: lead.joinedOn ?? lead.batch.sourceDate }, transaction);
        update.batchId = batch.id;
        activity = { kind: "PLAN_UPDATED", note: `来源渠道调整为 ${channel.name}`, occurredOn: lead.joinedOn ?? lead.batch.sourceDate };
      } else if (input.action === "setOwner") {
        const target = await transaction.user.findFirst({ where: { id: input.userId, groupId: actor.groupId, active: true }, select: { id: true, name: true } });
        if (!target) return { status: 400 as const, error: "只能选择本组在职组员" };
        update.ownerId = target.id;
        update.attributionOwnerId = target.id;
        activity = { kind: "PLAN_UPDATED", note: `接粉及业绩归属纠正为 ${target.name}`, occurredOn: lead.joinedOn ?? lead.batch.sourceDate };
      } else if (input.action === "setRegistration") {
        if (!lead.expertOwnerId) return { status: 400 as const, error: "请先选择专家负责人" };
        if (lead.registeredOn) return { status: 400 as const, error: `该客户已经在 ${lead.registeredOn} 登记注册` };
        if (lead.joinedOn && input.occurredOn < lead.joinedOn) return { status: 400 as const, error: "注册日期不能早于进群日期" };
        update.registeredOn = input.occurredOn;
        update.expertWorkflowStage = "PENDING_ORDER";
        update.expertStageChangedAt = new Date();
        activity = { kind: "REGISTERED", note: "专家在共享表登记客户注册", occurredOn: input.occurredOn };
      } else {
        if (lead.joinedOn && input.occurredOn < lead.joinedOn) return { status: 400 as const, error: "退群日期不能早于进群日期" };
        update.groupStatus = "LEFT";
        update.leftOn = input.occurredOn;
        update.leftWithOrder = input.leaveType === "NORMAL";
        update.leftAutomatically = false;
        activity = { kind: "LEFT_GROUP", note: input.leaveType === "NORMAL" ? "标记正常退群" : "标记异常退群", occurredOn: input.occurredOn };
      }

      await transaction.leadCustomer.update({ where: { id: lead.id }, data: update });
      if (activity) await transaction.leadActivity.create({ data: { leadId: lead.id, actorId: actor.id, ...activity } });
      if (lead.isHistoricalRecord && input.action === "assignExpert" && !lead.expertIntroducedOn) {
        await incrementHistoricalCustomerDailyStat(transaction, { ownerId: lead.groupOperatorOwnerId ?? actor.id, groupId: actor.groupId, channelId: lead.batch.channelId, businessDate: today, position: "GROUP_OPERATOR", sourceReceptionId: lead.attributionOwnerId ?? lead.ownerId, reason: `${lead.phone} 老客户推专家`, increment: { expertIntroCount: 1 } });
      } else if (lead.isHistoricalRecord && input.action === "setRegistration") {
        await incrementHistoricalCustomerDailyStat(transaction, { ownerId: lead.expertOwnerId!, groupId: actor.groupId, channelId: lead.batch.channelId, businessDate: input.occurredOn, position: "EXPERT", sourceReceptionId: lead.attributionOwnerId ?? lead.ownerId, sourceGroupOperatorId: lead.groupOperatorOwnerId ?? lead.expertOwnerId, reason: `${lead.phone} 老客户注册`, increment: { registrationCount: 1 } });
      } else if (lead.isHistoricalRecord && input.action === "setLeave" && !lead.leftOn) {
        await incrementHistoricalCustomerDailyStat(transaction, { ownerId: lead.groupOperatorOwnerId ?? actor.id, groupId: actor.groupId, channelId: lead.batch.channelId, businessDate: input.occurredOn, position: "GROUP_OPERATOR", sourceReceptionId: lead.attributionOwnerId ?? lead.ownerId, reason: `${lead.phone} 老客户退群`, increment: input.leaveType === "NORMAL" ? { normalLeaveCount: 1, currentInGroupCount: -1 } : { abnormalLeaveCount: 1, currentInGroupCount: -1 } });
      }
      await recordAudit(transaction, { actorId: actor.id, action: `SHARED_CUSTOMER_${input.action}`, entityType: "LeadCustomer", entityId: lead.id, summary: { input, before: { ownerId: lead.ownerId, attributionOwnerId: lead.attributionOwnerId, groupOperatorOwnerId: lead.groupOperatorOwnerId, expertOwnerId: lead.expertOwnerId, deviceId: lead.deviceId, batchId: lead.batchId, registeredOn: lead.registeredOn, leftOn: lead.leftOn }, update } });
      return { status: 200 as const };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
