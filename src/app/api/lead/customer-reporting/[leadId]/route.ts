import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../../lib/auth";
import { db, getOrCreateSourceBatch } from "../../../../../lib/db";
import { recordAudit } from "../../../../../lib/audit";
import { hasAssignedRole, isFrontlineGroupMember } from "../../../../../lib/role-access";
import { API_LIMITS } from "../../../../../lib/request-limits";
import { authorizationDenied } from "../../../../../lib/security-events";
import { leadCurrentGroupId } from "../../../../../lib/customer-current-group";
import { statisticsDate } from "../../../../../lib/statistics-date";
import { reattributeCustomerNumberEvents, syncCustomerExpertEvent, syncCustomerGroupEvent, syncCustomerRegistrationEvent } from "../../../../../lib/customer-number-event-sync";
import { entryDateError } from "../../../../../lib/entry-date-validation";
import { allocateCustomerStageNumber } from "../../../../../lib/customer-stage-number";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assignGroupOperator"), userId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setDeviceCode"), code: z.string().trim().max(100, "设备号不能超过 100 个字") }),
  z.object({ action: z.literal("assignExpert"), userId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setChannel"), channelId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setOwner"), userId: z.string().min(1).max(API_LIMITS.identifierCharacters) }),
  z.object({ action: z.literal("setCustomerName"), customerName: z.string().trim().max(80, "客户姓名不能超过 80 个字") }),
  z.object({ action: z.literal("setCustomerPlatform"), customerPlatform: z.string().trim().max(100, "平台名称不能超过 100 个字") }),
  z.object({ action: z.literal("setLossAmount"), amountCents: z.number().int().min(0, "被骗金额不能小于 0").max(999_999_999_999, "被骗金额过大").nullable() }),
  z.object({ action: z.literal("setSourceDate"), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("setJoinedOn"), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("setRegistration"), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("setLeave"), leaveType: z.enum(["NORMAL", "ABNORMAL", "NONE"]), occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
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
        include: {
          batch: { select: { groupId: true, channelId: true, sourceDate: true } },
          customerOrder: { select: { openedOn: true, voidedAt: true } },
        },
      });
      if (!actor?.active || !actor.groupId || !lead || leadCurrentGroupId(lead) !== actor.groupId)
        return { status: 404 as const, error: "客户不存在或已不在本组" };
      const update: Record<string, unknown> = {};
      let trackedAttributionOwnerId = lead.attributionOwnerId;
      let trackedGroupOperatorOwnerId = lead.groupOperatorOwnerId;
      let trackedExpertOwnerId = lead.expertOwnerId;
      let trackedChannelId = lead.batch.channelId;
      let activity: { kind: "DEVICE_ASSIGNED" | "EXPERT_INTRODUCED" | "REGISTERED" | "LEFT_GROUP" | "PLAN_UPDATED"; note: string; occurredOn: string } | null = null;
      const today = statisticsDate();

      if (input.action === "setRegistration" && !hasAssignedRole(actor, "EXPERT"))
        return { status: 403 as const, error: "需要专家权限才能登记注册" };

      if (input.action === "assignGroupOperator") {
        const target = await transaction.user.findFirst({ where: { id: input.userId, groupId: actor.groupId, active: true }, select: { id: true, name: true } });
        if (!target) return { status: 400 as const, error: "只能选择本组在职组员" };
        trackedGroupOperatorOwnerId = target.id;
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
        trackedExpertOwnerId = target.id;
        if (!lead.groupQueueNumber) {
          update.groupQueueNumber = await allocateCustomerStageNumber(transaction, actor.groupId, "GROUP");
          update.groupQueueGroupId = actor.groupId;
        }
        if (!lead.expertQueueNumber) {
          update.expertQueueNumber = await allocateCustomerStageNumber(transaction, actor.groupId, "EXPERT");
          update.expertQueueGroupId = actor.groupId;
        }
        update.expertOwnerId = target.id;
        update.expertIntroducedOn = lead.expertIntroducedOn ?? today;
        update.expertWorkflowStage = lead.expertWorkflowStage ?? "QUEUED";
        update.expertStageChangedAt = new Date();
        activity = { kind: "EXPERT_INTRODUCED", note: `专家负责人调整为 ${target.name}`, occurredOn: lead.expertIntroducedOn ?? today };
      } else if (input.action === "setChannel") {
        const channel = await transaction.channel.findUnique({ where: { id_groupId: { id: input.channelId, groupId: actor.groupId } }, select: { id: true, name: true, active: true } });
        if (!channel?.active) return { status: 400 as const, error: "来源渠道不存在或已停用" };
        const batch = await getOrCreateSourceBatch({ groupId: actor.groupId, channelId: channel.id, sourceDate: lead.batch.sourceDate }, transaction);
        trackedChannelId = channel.id;
        update.batchId = batch.id;
        activity = { kind: "PLAN_UPDATED", note: `来源渠道调整为 ${channel.name}`, occurredOn: lead.joinedOn ?? lead.batch.sourceDate };
      } else if (input.action === "setOwner") {
        const target = await transaction.user.findFirst({ where: { id: input.userId, groupId: actor.groupId, active: true }, select: { id: true, name: true } });
        if (!target) return { status: 400 as const, error: "只能选择本组在职组员" };
        trackedAttributionOwnerId = target.id;
        update.ownerId = target.id;
        update.attributionOwnerId = target.id;
        activity = { kind: "PLAN_UPDATED", note: `接粉及业绩归属纠正为 ${target.name}`, occurredOn: lead.joinedOn ?? lead.batch.sourceDate };
      } else if (input.action === "setCustomerName") {
        update.customerName = input.customerName || null;
        activity = { kind: "PLAN_UPDATED", note: input.customerName ? `客户姓名调整为 ${input.customerName}` : "客户姓名已清空", occurredOn: today };
      } else if (input.action === "setCustomerPlatform") {
        update.customerPlatform = input.customerPlatform || null;
        activity = { kind: "PLAN_UPDATED", note: input.customerPlatform ? `客户平台调整为 ${input.customerPlatform}` : "客户平台已清空", occurredOn: today };
      } else if (input.action === "setLossAmount") {
        update.lossAmountCents = input.amountCents;
        activity = { kind: "PLAN_UPDATED", note: input.amountCents === null ? "被骗金额已清空" : `被骗金额调整为 $${(input.amountCents / 100).toFixed(2)}`, occurredOn: today };
      } else if (input.action === "setSourceDate") {
        const dateError = entryDateError(input.occurredOn, today, "接粉日期");
        if (dateError) return { status: 400 as const, error: dateError };
        if (lead.joinedOn && input.occurredOn > lead.joinedOn) return { status: 400 as const, error: "接粉日期不能晚于进群日期" };
        const batch = await getOrCreateSourceBatch({ groupId: actor.groupId, channelId: lead.batch.channelId, sourceDate: input.occurredOn }, transaction);
        update.batchId = batch.id;
        activity = { kind: "PLAN_UPDATED", note: `接粉日期调整为 ${input.occurredOn}`, occurredOn: today };
      } else if (input.action === "setJoinedOn") {
        const dateError = entryDateError(input.occurredOn, today, "进群日期");
        if (dateError) return { status: 400 as const, error: dateError };
        if (input.occurredOn < lead.batch.sourceDate) return { status: 400 as const, error: "进群日期不能早于接粉日期" };
        if (lead.leftOn && input.occurredOn > lead.leftOn) return { status: 400 as const, error: "进群日期不能晚于退群日期" };
        if (lead.expertIntroducedOn && input.occurredOn > lead.expertIntroducedOn) return { status: 400 as const, error: "进群日期不能晚于推专家日期" };
        if (lead.registeredOn && input.occurredOn > lead.registeredOn) return { status: 400 as const, error: "进群日期不能晚于注册日期" };
        if (!lead.groupQueueNumber) {
          update.groupQueueNumber = await allocateCustomerStageNumber(transaction, actor.groupId, "GROUP");
          update.groupQueueGroupId = actor.groupId;
        }
        update.joinedOn = input.occurredOn;
        activity = { kind: "PLAN_UPDATED", note: `进群日期调整为 ${input.occurredOn}`, occurredOn: today };
      } else if (input.action === "setRegistration") {
        if (!lead.expertOwnerId) return { status: 400 as const, error: "请先选择专家负责人" };
        if (lead.registeredOn) return { status: 400 as const, error: `该客户已经在 ${lead.registeredOn} 登记注册` };
        if (lead.joinedOn && input.occurredOn < lead.joinedOn) return { status: 400 as const, error: "注册日期不能早于进群日期" };
        update.registeredOn = input.occurredOn;
        update.expertWorkflowStage = "PENDING_ORDER";
        update.expertStageChangedAt = new Date();
        activity = { kind: "REGISTERED", note: "专家在共享表登记客户注册", occurredOn: input.occurredOn };
      } else {
        if (input.leaveType === "NONE") {
          if (!lead.leftOn) return { status: 400 as const, error: "该客户当前没有退群记录" };
          update.groupStatus = "JOINED";
          update.leftOn = null;
          update.leftWithOrder = null;
          update.leftNote = null;
          update.leftAutomatically = false;
          if (lead.isHistoricalRecord) update.historicalLeaveCounted = false;
          activity = { kind: "PLAN_UPDATED", note: "纠错：撤销退群记录", occurredOn: today };
        } else {
          if (!input.occurredOn) return { status: 400 as const, error: "请填写退群日期" };
          const dateError = entryDateError(input.occurredOn, today, "退群日期");
          if (dateError) return { status: 400 as const, error: dateError };
          if (lead.joinedOn && input.occurredOn < lead.joinedOn) return { status: 400 as const, error: "退群日期不能早于进群日期" };
          update.groupStatus = "LEFT";
          update.leftOn = input.occurredOn;
          update.leftWithOrder = input.leaveType === "NORMAL";
          update.leftAutomatically = false;
          if (lead.isHistoricalRecord) update.historicalLeaveCounted = true;
          activity = { kind: "LEFT_GROUP", note: lead.leftOn ? `纠错：退群调整为${input.leaveType === "NORMAL" ? "正常" : "异常"}退群，日期 ${input.occurredOn}` : input.leaveType === "NORMAL" ? "标记正常退群" : "标记异常退群", occurredOn: input.occurredOn };
        }
      }

      await transaction.leadCustomer.update({ where: { id: lead.id }, data: update });
      if (activity) await transaction.leadActivity.create({ data: { leadId: lead.id, actorId: actor.id, ...activity } });
      const trackedLead = {
        ...lead,
        attributionOwnerId: trackedAttributionOwnerId,
        groupOperatorOwnerId: trackedGroupOperatorOwnerId,
        expertOwnerId: trackedExpertOwnerId,
        batch: { groupId: actor.groupId, channelId: trackedChannelId },
      };
      const attributionChanged = (input.action === "setChannel" && trackedChannelId !== lead.batch.channelId)
        || (input.action === "setOwner" && trackedAttributionOwnerId !== lead.attributionOwnerId);
      if (attributionChanged) {
        await reattributeCustomerNumberEvents(transaction, {
          ...lead,
          batch: { groupId: actor.groupId, channelId: lead.batch.channelId },
        }, trackedLead);
      }
      if (input.action === "setJoinedOn" && lead.joinedOn !== input.occurredOn) {
        if (lead.joinedOn) await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: lead.joinedOn, kind: "JOIN", delta: -1 });
        await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: input.occurredOn, kind: "JOIN" });
      } else if (input.action === "assignExpert" && !lead.expertIntroducedOn) {
        await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: today, kind: "EXPERT_INTRO" });
        await syncCustomerExpertEvent(transaction, trackedLead, { businessDate: today, kind: "RECEIVED" });
      } else if (input.action === "setRegistration") {
        await syncCustomerRegistrationEvent(transaction, trackedLead, input.occurredOn);
      } else if (input.action === "setLeave") {
        if (lead.leftOn) await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: lead.leftOn, kind: lead.leftWithOrder ? "NORMAL_LEAVE" : "ABNORMAL_LEAVE", delta: -1 });
        if (input.leaveType !== "NONE" && input.occurredOn) await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: input.occurredOn, kind: input.leaveType === "NORMAL" ? "NORMAL_LEAVE" : "ABNORMAL_LEAVE" });
      }
      await recordAudit(transaction, { actorId: actor.id, action: `SHARED_CUSTOMER_${input.action}`, entityType: "LeadCustomer", entityId: lead.id, summary: { input, before: { customerName: lead.customerName, customerPlatform: lead.customerPlatform, lossAmountCents: lead.lossAmountCents, ownerId: lead.ownerId, attributionOwnerId: lead.attributionOwnerId, groupOperatorOwnerId: lead.groupOperatorOwnerId, expertOwnerId: lead.expertOwnerId, deviceId: lead.deviceId, batchId: lead.batchId, sourceDate: lead.batch.sourceDate, joinedOn: lead.joinedOn, registeredOn: lead.registeredOn, leftOn: lead.leftOn }, update } });
      return { status: 200 as const };
    });
    if ("error" in result) {
      if (result.status === 403) return authorizationDenied(sessionUser, result.error);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
