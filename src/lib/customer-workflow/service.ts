import type { LeadActivityKind } from "@prisma/client";
import { db } from "../db";
import { recordAudit } from "../audit";
import { normalizeCustomerPhone } from "../entry-ledger";
import { authorizeCustomerAction, authorizeCustomerDelete, resolveWorkflowActorRole } from "./access";
import { isCorrectionAction } from "./actions";
import { frontlineMemberRoles, hasAssignedRole, isFrontlineGroupMember } from "../role-access";
import type { CustomerWorkflowInput } from "./input";
import { buildBasicCustomerMutation } from "./mutations";
import { resolveExpertWorkflowStage } from "../expert-workflow-stage";
import { leadCurrentGroupId } from "../customer-current-group";
import { syncCustomerExpertEvent, syncCustomerGroupEvent, syncCustomerOrderEvent, syncCustomerRegistrationEvent } from "../customer-number-event-sync";

type WorkflowActor = {
  id: string;
};

// 日期字段本身只保存“哪一天”。阶段时间则固定存到当天中午 UTC，避免
// 不同时区在界面上显示成前一天，同时也能作为下一步的最早日期依据。
function workflowStageTime(occurredOn: string) {
  return new Date(`${occurredOn}T12:00:00.000Z`);
}

function workflowStageDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export async function executeCustomerWorkflow(
  actor: WorkflowActor,
  leadId: string,
  input: CustomerWorkflowInput,
  occurredOn: string,
) {
  return db.$transaction(async (transaction) => {
    // Do not trust the role stored in an old browser session. An account can
    // be disabled or moved while this request is in flight.
    const liveActor = await transaction.user.findUnique({
      where: { id: actor.id },
      select: { id: true, role: true, groupId: true, active: true, roleAssignments: { select: { role: true } } },
    });
    if (!liveActor || !isFrontlineGroupMember(liveActor))
      return { status: 403 as const, error: "当前岗位不能在此修改客户" };

    const lead = await transaction.leadCustomer.findUnique({
      where: { id: leadId },
      include: { batch: { select: { groupId: true, channelId: true } }, customerOrder: { select: { id: true, voidedAt: true, openedOn: true, initialDepositCents: true, initialDepositMethod: true } } },
    });
    if (!lead) return { status: 404 as const, error: "客户不存在" };
    const currentGroupId = leadCurrentGroupId(lead);

    // The reporting APIs deliberately infer a stage for customers created before
    // expertWorkflowStage existed. Mutations must use the same interpretation,
    // otherwise the page can show "追踪中" while the save endpoint rejects it.
    const currentExpertStage = resolveExpertWorkflowStage({
      ...lead,
      hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
    });

    const accessFailure = await authorizeCustomerAction(transaction, liveActor, lead, input.action);
    if (accessFailure) return accessFailure;
    const workflowRole = resolveWorkflowActorRole(liveActor, lead, input.action);
    if (!workflowRole) return { status: 403 as const, error: "当前岗位不能处理该客户" };
    if (isCorrectionAction(input.action) && !input.reason)
      return { status: 400 as const, error: "请填写纠错原因" };

    const update: Record<string, unknown> = {};
    let activityKind: LeadActivityKind | undefined;
    let activityNote: string | undefined;
    const basicMutation = buildBasicCustomerMutation(input, lead, occurredOn);
    if (basicMutation && "error" in basicMutation) return basicMutation;
    if (basicMutation) {
      Object.assign(update, basicMutation.update);
      activityKind = basicMutation.activityKind;
      activityNote = basicMutation.activityNote;
    }

    if (input.action === "joinGroup" && !lead.groupOperatorOwnerId) {
      const assignment = await transaction.groupOperatorReception.findUnique({
        where: { receptionistId: lead.ownerId },
        select: { groupOperatorId: true },
      });
      if (assignment) update.groupOperatorOwnerId = assignment.groupOperatorId;
      else if (lead.ownerId === liveActor.id && hasAssignedRole(liveActor, "RECEPTION") && hasAssignedRole(liveActor, "GROUP_OPERATOR"))
        update.groupOperatorOwnerId = liveActor.id;
      else return { status: 400 as const, error: "当前接粉尚未配对炒群，请组长先完成配对" };
    }

    const updatingReceptionDevice = input.action === "updateProfile" && Boolean(input.deviceId || input.deviceCode);
    if (input.action === "assignDevice" || updatingReceptionDevice) {
      if (!input.deviceId && !input.deviceCode) return { status: 400 as const, error: "请输入设备号" };
      if (updatingReceptionDevice && workflowRole !== "RECEPTION")
        return { status: 403 as const, error: "只有前台接粉可以修改前台接粉设备号" };
      let device = input.deviceId
        ? await transaction.device.findUnique({ where: { id: input.deviceId } })
        : await transaction.device.findUnique({
            where: { groupId_code: { groupId: currentGroupId, code: input.deviceCode! } },
          });
      if (!device && input.deviceCode) {
        device = await transaction.device.create({
          data: {
            code: input.deviceCode,
            groupId: currentGroupId,
            memberId: workflowRole === "RECEPTION" ? liveActor.id : null,
          },
        });
      }
      if (!device || !device.active || device.groupId !== currentGroupId)
        return { status: 400 as const, error: "设备号不存在或已停用" };
      if (workflowRole === "RECEPTION" && device.memberId !== liveActor.id)
        return { status: 403 as const, error: "只能使用分配给自己的设备号" };
      update.deviceId = device.id;
      activityKind = "DEVICE_ASSIGNED";
    }

    if (input.action === "introduceExpert") {
      if (lead.groupStatus === "NOT_JOINED") return { status: 400 as const, error: "客户确认进群后才能推专家" };
      if (!lead.joinedOn) return { status: 400 as const, error: "客户缺少入群日期，请先修正入群记录" };
      if (occurredOn < lead.joinedOn) return { status: 400 as const, error: "推专家日期不能早于入群日期" };
      if (lead.expertIntroducedOn && occurredOn < lead.expertIntroducedOn)
        return { status: 400 as const, error: "负责人分配日期不能早于推专家日期" };
      if (lead.expertIntroducedOn && lead.expertOwnerId)
        return { status: 400 as const, error: "该客户已推专家并分配负责人" };
      const assignee = await transaction.user.findFirst({
        where: {
          groupId: currentGroupId,
          active: true,
          ...(input.expertOwnerId
            ? { id: input.expertOwnerId, role: { in: [...frontlineMemberRoles] } }
            : { role: "LEAD" }),
        },
        select: { id: true, name: true },
      });
      if (!assignee) return { status: 400 as const, error: input.expertOwnerId ? "只能选择本组在职组员" : "本组没有启用的组长，请选择一位组员" };
      if (!lead.expertIntroducedOn) update.expertIntroducedOn = occurredOn;
      if (lead.isHistoricalRecord) update.historicalExpertIntroCounted = true;
      update.expertOwnerId = assignee.id;
      update.expertDeviceAccountId = null;
      update.expertDeviceAccountNumber = null;
      update.expertContactedOn = null;
      update.expertContactNote = null;
      update.expertWorkflowStage = "QUEUED";
      update.expertStageChangedAt = workflowStageTime(occurredOn);
      update.expertTrackingStartedAt = null;
      activityKind = "EXPERT_INTRODUCED";
      activityNote = `${lead.expertIntroducedOn ? "补充" : "推专家并"}分配给 ${assignee.name}；专家接手时填写自己的设备号`;
    }

    if (input.action === "markExpertContacted") {
      if (!lead.expertIntroducedOn || !lead.expertOwnerId)
        return { status: 400 as const, error: "请先推专家并分配负责人" };
      if (occurredOn < lead.expertIntroducedOn)
        return { status: 400 as const, error: "专家联系日期不能早于推专家日期" };
      if (lead.expertContactedOn) return { status: 400 as const, error: "该客户已经联系专家" };
      update.expertContactedOn = occurredOn;
      update.expertContactNote = input.contactNote?.trim() || null;
      update.expertWorkflowStage = "MATERIALS";
      update.expertStageChangedAt = workflowStageTime(occurredOn);
      activityKind = "EXPERT_CONTACTED";
      activityNote = input.contactNote?.trim() || "专家已开始接待，等待交资料";
    }

    if (input.action === "beginExpertReception") {
      if (!lead.expertIntroducedOn || !lead.expertOwnerId)
        return { status: 400 as const, error: "请先推专家并分配负责人" };
      if (occurredOn < lead.expertIntroducedOn)
        return { status: 400 as const, error: "开始接待日期不能早于推专家日期" };
      if (currentExpertStage !== "QUEUED")
        return { status: 400 as const, error: "该客户已开始专家流程，无需重复接待" };
      if (!input.expertDeviceAccountId && !input.expertDeviceAccountNumber)
        return { status: 400 as const, error: "请输入本次接待使用的专家设备号" };
      const expertAccount = input.expertDeviceAccountId ? await transaction.deviceAccount.findFirst({
        where: { id: input.expertDeviceAccountId, groupId: currentGroupId, ownerId: liveActor.id },
        select: { id: true, accountNumber: true },
      }) : null;
      if (input.expertDeviceAccountId && !expertAccount)
        return { status: 400 as const, error: "只能使用自己名下的专家设备号" };
      const expertDeviceNumber = expertAccount?.accountNumber ?? input.expertDeviceAccountNumber!.trim();
      update.expertDeviceAccountId = expertAccount?.id ?? null;
      update.expertDeviceAccountNumber = expertDeviceNumber;
      update.expertContactedOn = lead.expertContactedOn ?? occurredOn;
      update.expertContactNote = input.contactNote?.trim() || lead.expertContactNote || null;
      update.expertWorkflowStage = "MATERIALS";
      update.expertStageChangedAt = workflowStageTime(occurredOn);
      activityKind = "EXPERT_CONTACTED";
      activityNote = input.contactNote?.trim() || `专家已接待（设备号：${expertDeviceNumber}），等待客户交资料`;
    }

    if (input.action === "beginExpertTracking") {
      if (!lead.expertIntroducedOn || !lead.expertOwnerId)
        return { status: 400 as const, error: "请先推专家并分配负责人" };
      if (lead.expertWorkflowStage && lead.expertWorkflowStage !== "MATERIALS")
        return { status: 400 as const, error: "客户当前不在交资料阶段" };
      if (!lead.expertWorkflowStage && !lead.expertContactedOn)
        return { status: 400 as const, error: "请先由专家开始接待，再进入追踪" };
      if (!lead.expertContactedOn)
        return { status: 400 as const, error: "请先由专家开始接待，再进入追踪" };
      if (occurredOn < lead.expertContactedOn)
        return { status: 400 as const, error: "开始追踪日期不能早于专家接待日期" };
      update.expertWorkflowStage = "TRACKING";
      update.expertStageChangedAt = workflowStageTime(occurredOn);
      update.expertTrackingStartedAt = workflowStageTime(occurredOn);
      activityKind = "PLAN_UPDATED";
      activityNote = "资料已交，开始 48 小时追踪";
    }

    if (input.action === "markPendingRegistration") {
      if (currentExpertStage !== "TRACKING")
        return { status: 400 as const, error: "客户需先处于追踪中，才能转为待注册" };
      const compatibleTrackingStartedAt = lead.expertTrackingStartedAt
        ?? (lead.expertContactedOn ? workflowStageTime(lead.expertContactedOn) : null);
      const trackingStartedOn = workflowStageDate(compatibleTrackingStartedAt);
      if (!trackingStartedOn)
        return { status: 400 as const, error: "客户缺少开始追踪日期，请先修正追踪记录" };
      if (occurredOn < trackingStartedOn)
        return { status: 400 as const, error: "转待注册日期不能早于开始追踪日期" };
      update.expertWorkflowStage = "PENDING_REGISTRATION";
      update.expertStageChangedAt = workflowStageTime(occurredOn);
      if (!lead.expertTrackingStartedAt) update.expertTrackingStartedAt = compatibleTrackingStartedAt;
      activityKind = "PLAN_UPDATED";
      activityNote = "追踪完成，转为待注册";
    }

    if (input.action === "register") {
      if (currentExpertStage !== "PENDING_REGISTRATION")
        return { status: 400 as const, error: "客户需先转为待注册，才能确认注册" };
      const compatibleTrackingStartedAt = lead.expertTrackingStartedAt
        ?? (lead.expertContactedOn ? workflowStageTime(lead.expertContactedOn) : null);
      const trackingStartedOn = workflowStageDate(compatibleTrackingStartedAt);
      if (!trackingStartedOn)
        return { status: 400 as const, error: "客户缺少开始追踪日期，请先修正追踪记录" };
      if (occurredOn < trackingStartedOn)
        return { status: 400 as const, error: "注册日期不能早于开始追踪日期" };
      update.expertWorkflowStage = "PENDING_ORDER";
      update.expertStageChangedAt = workflowStageTime(occurredOn);
      if (!lead.expertTrackingStartedAt) update.expertTrackingStartedAt = compatibleTrackingStartedAt;
      if (lead.isHistoricalRecord) update.historicalRegistrationCounted = true;
    }
    if (input.action === "undoRegister") {
      update.expertWorkflowStage = "PENDING_REGISTRATION";
      update.expertStageChangedAt = new Date();
      if (lead.isHistoricalRecord) update.historicalRegistrationCounted = false;
    }
    if (input.action === "undoExpertContacted") {
      update.expertWorkflowStage = "QUEUED";
      update.expertStageChangedAt = new Date();
      update.expertTrackingStartedAt = null;
      update.expertDeviceAccountId = null;
      update.expertDeviceAccountNumber = null;
    }
    if (input.action === "undoIntroduceExpert") {
      update.expertWorkflowStage = null;
      update.expertStageChangedAt = new Date();
      update.expertTrackingStartedAt = null;
    }
    if (input.action === "markNoInitialDeposit") {
      update.expertWorkflowStage = "DECLINED_DEPOSIT";
      update.expertStageChangedAt = new Date();
    }
    if (input.action === "clearNoInitialDeposit") {
      update.expertWorkflowStage = "PENDING_ORDER";
      update.expertStageChangedAt = new Date();
    }
    if (input.action === "markExpertStalled") {
      update.expertWorkflowStage = "STALLED";
      update.expertStageChangedAt = new Date();
    }
    if (input.action === "clearExpertStalled") {
      update.expertWorkflowStage = lead.registeredOn ? "PENDING_ORDER" : "TRACKING";
      update.expertStageChangedAt = new Date();
    }

    if (input.action === "updateGroupProgress") {
      if (workflowRole !== "LEAD" && workflowRole !== "GROUP_OPERATOR")
        return { status: 403 as const, error: "只有组长和前台炒群可以填写群内每日进度" };
      if (lead.groupStatus === "NOT_JOINED" || !lead.joinedOn)
        return { status: 400 as const, error: "只有已经进过群的客户可以填写炒群情况" };
      if (occurredOn < lead.joinedOn)
        return { status: 400 as const, error: "进度日期不能早于客户入群日期" };
      if (!input.progressNote?.trim()) return { status: 400 as const, error: "请填写今日进度" };
      if (input.deviceAccountId) {
        const account = await transaction.deviceAccount.findFirst({
          where: { id: input.deviceAccountId, groupId: currentGroupId, ownerId: liveActor.id },
          select: { id: true, accountNumber: true },
        });
        if (!account) return { status: 403 as const, error: "只能使用自己名下的炒群联系号码" };
        update.groupDeviceAccountId = account.id;
        update.groupDeviceAccountNumber = account.accountNumber;
      }
    }

    if (input.action === "updateExpertDetails" && input.deviceAccountId) {
      const account = await transaction.deviceAccount.findFirst({
        where: { id: input.deviceAccountId, groupId: currentGroupId, ownerId: liveActor.id },
        select: { id: true, accountNumber: true },
      });
      if (!account) return { status: 403 as const, error: "只能使用自己名下的专家联系号码" };
      update.expertDeviceAccountId = account.id;
      update.expertDeviceAccountNumber = account.accountNumber;
    }

    if (input.action === "voidOrder") {
      const order = lead.customerOrder;
      if (!order || order.voidedAt) return { status: 400 as const, error: "该客户没有有效开单记录" };
      const laterFinance = await transaction.customerFinanceEvent.count({
        where: {
          customerOrderId: order.id,
          voidedAt: null,
          OR: [{ kind: "WITHDRAWAL" }, { kind: "RECHARGE", continuationNumber: { not: null } }],
        },
      });
      if (laterFinance) return { status: 400 as const, error: "请先逐笔作废续充或出金，再作废开单" };
      await transaction.customerOrder.update({
        where: { id: order.id },
        data: { voidedAt: new Date(), voidReason: input.reason, voidedById: liveActor.id },
      });
      await transaction.customerFinanceEvent.updateMany({
        where: { customerOrderId: order.id, voidedAt: null },
        data: { voidedAt: new Date(), voidReason: input.reason, voidedById: liveActor.id },
      });
      update.expertWorkflowStage = "PENDING_ORDER";
      update.expertStageChangedAt = new Date();
      activityKind = "ORDER_VOIDED";
    }

    if (input.action === "updatePhone") {
      if (!input.phone) return { status: 400 as const, error: "请输入手机号" };
      if (lead.customerOrder) return { status: 400 as const, error: "该客户已经开单，不能修改手机号" };
      let phone: string;
      try {
        phone = normalizeCustomerPhone(input.phone);
      } catch {
        return { status: 400 as const, error: "客户号码必须包含数字，系统会自动保留末 6 位" };
      }
      const collision = await transaction.leadCustomer.findFirst({
        where: { phone, id: { not: lead.id } },
        select: { owner: { select: { name: true } }, currentGroupId: true, batch: { select: { groupId: true } } },
      });
      if (collision) {
        const owner = leadCurrentGroupId(collision) === currentGroupId ? collision.owner.name : "其他公司或小组";
        return { status: 409 as const, error: `该号码已归属 ${owner}，不能重复录入` };
      }
      update.phone = phone;
    }

    const updated = await transaction.leadCustomer.update({
      where: { id: lead.id },
      data: update,
      include: {
        device: { select: { id: true, code: true } },
        customerOrder: {
          select: {
            id: true,
            openedOn: true,
            initialDepositCents: true,
            voidedAt: true,
            voidReason: true,
            events: {
              where: { kind: { in: ["RECHARGE", "WITHDRAWAL"] } },
              select: { id: true, kind: true, amountCents: true, occurredOn: true, continuationNumber: true, voidedAt: true, voidReason: true },
            },
          },
        },
      },
    });

    if (input.action === "updateGroupProgress") {
      const existingProgress = await transaction.leadActivity.findFirst({
        where: { leadId: lead.id, kind: "GROUP_PROGRESS_UPDATED", occurredOn },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (existingProgress) {
        await transaction.leadActivity.update({
          where: { id: existingProgress.id },
          data: { actorId: liveActor.id, note: input.progressNote!.trim() },
        });
      } else {
        await transaction.leadActivity.create({
          data: { leadId: lead.id, actorId: liveActor.id, kind: "GROUP_PROGRESS_UPDATED", occurredOn, note: input.progressNote!.trim() },
        });
      }
    } else if (activityKind) {
      await transaction.leadActivity.create({
        data: { leadId: lead.id, actorId: liveActor.id, kind: activityKind, occurredOn, note: activityNote ?? input.reason ?? undefined },
      });
    }

    const trackedLead = { ...updated, batch: lead.batch };
    if (input.action === "joinGroup") {
      await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: occurredOn, kind: "JOIN" });
    } else if (input.action === "leaveGroup") {
      await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: occurredOn, kind: updated.leftWithOrder ? "NORMAL_LEAVE" : "ABNORMAL_LEAVE" });
    } else if (input.action === "introduceExpert" && !lead.expertIntroducedOn) {
      await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: occurredOn, kind: "EXPERT_INTRO" });
      await syncCustomerExpertEvent(transaction, trackedLead, { businessDate: occurredOn, kind: "RECEIVED" });
    } else if ((input.action === "markExpertContacted" || input.action === "beginExpertReception") && !lead.expertContactedOn) {
      await syncCustomerExpertEvent(transaction, trackedLead, { businessDate: occurredOn, kind: "CONTACTED" });
    } else if (input.action === "register") {
      await syncCustomerRegistrationEvent(transaction, trackedLead, occurredOn);
    } else if (input.action === "undoJoinGroup" && lead.joinedOn) {
      await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: lead.joinedOn, kind: "JOIN", delta: -1 });
    } else if (input.action === "undoLeaveGroup" && lead.leftOn) {
      await syncCustomerGroupEvent(transaction, trackedLead, { businessDate: lead.leftOn, kind: lead.leftWithOrder ? "NORMAL_LEAVE" : "ABNORMAL_LEAVE", delta: -1 });
    } else if (input.action === "undoIntroduceExpert" && lead.expertIntroducedOn) {
      await syncCustomerGroupEvent(transaction, { ...trackedLead, groupOperatorOwnerId: lead.groupOperatorOwnerId }, { businessDate: lead.expertIntroducedOn, kind: "EXPERT_INTRO", delta: -1 });
      await syncCustomerExpertEvent(transaction, { ...trackedLead, groupOperatorOwnerId: lead.groupOperatorOwnerId, expertOwnerId: lead.expertOwnerId }, { businessDate: lead.expertIntroducedOn, kind: "RECEIVED", delta: -1 });
    } else if (input.action === "undoExpertContacted" && lead.expertContactedOn) {
      await syncCustomerExpertEvent(transaction, { ...trackedLead, expertOwnerId: lead.expertOwnerId }, { businessDate: lead.expertContactedOn, kind: "CONTACTED", delta: -1 });
    } else if (input.action === "undoRegister" && lead.registeredOn) {
      await syncCustomerRegistrationEvent(transaction, { ...trackedLead, expertOwnerId: lead.expertOwnerId }, lead.registeredOn, -1);
    } else if (input.action === "voidOrder" && lead.customerOrder) {
      await syncCustomerOrderEvent(transaction, { ...trackedLead, expertOwnerId: lead.expertOwnerId }, {
        businessDate: lead.customerOrder.openedOn,
        delta: -1,
      });
    }

    if (input.action === "reply" || input.action === "undoReply") {
      await recordAudit(transaction, {
        actorId: liveActor.id,
        action: input.action === "reply" ? "LEAD_REPLY_MARKED" : "LEAD_REPLY_UNDONE",
        entityType: "LeadCustomer",
        entityId: lead.id,
        summary: {
          phone: lead.phone,
          occurredOn,
          reason: input.action === "undoReply" ? input.reason : null,
        },
      });
    }
    if (["updateReceptionChatStatus", "archiveRepliedCustomer", "restoreReceptionArchive"].includes(input.action)) {
      await recordAudit(transaction, {
        actorId: liveActor.id,
        action: input.action === "updateReceptionChatStatus"
          ? "LEAD_RECEPTION_STATUS_UPDATED"
          : input.action === "archiveRepliedCustomer" ? "LEAD_RECEPTION_ARCHIVED" : "LEAD_RECEPTION_ARCHIVE_RESTORED",
        entityType: "LeadCustomer",
        entityId: lead.id,
        summary: input.action === "updateReceptionChatStatus"
          ? { receptionChatStatus: input.receptionChatStatus }
          : input.action === "archiveRepliedCustomer"
            ? { archiveVisitCount: input.archiveVisitCount, reason: input.reason }
            : { reason: input.reason },
      });
    }

    const profileAutoLowAmount = input.action === "updateProfile" && input.lossAmountCents !== undefined && input.lossAmountCents !== null && input.lossAmountCents < 500_000;
    if (input.action === "voidErroneousEntry" || (input.action === "classifyReception" && input.receptionCategory !== "VALID") || profileAutoLowAmount) {
      await transaction.leadException.create({
        data: {
          leadId: lead.id,
          batchId: lead.batchId,
          actorId: liveActor.id,
          ownerId: lead.ownerId,
          phone: lead.phone,
          kind: "MANUAL_INVALID",
          reason: input.action === "voidErroneousEntry"
            ? `误录作废：${input.reason || "未填写原因"}`
            : profileAutoLowAmount
            ? "低金额（低于 $5,000）"
            : input.action === "classifyReception"
            ? input.receptionCategory === "LOW_AMOUNT"
              ? "低金额（低于 $5,000）"
              : input.receptionCategory === "NO_WS" ? "无 WS 号码" : "无效"
            : input.reason || "未填写原因",
          occurredOn,
        },
      });
    }
    return { status: 200 as const, lead: updated };
  });
}

export async function deleteCustomerWorkflow(actor: WorkflowActor, leadId: string) {
  return db.$transaction(async (transaction) => {
    const liveActor = await transaction.user.findUnique({
      where: { id: actor.id },
      select: { id: true, role: true, groupId: true, active: true, roleAssignments: { select: { role: true } } },
    });
    if (!liveActor?.active) return { status: 403 as const, error: "当前岗位不能删除客户" };
    const lead = await transaction.leadCustomer.findUnique({
      where: { id: leadId },
      include: { batch: { select: { groupId: true, sourceDate: true, isHistoricalRecord: true } }, customerOrder: { select: { id: true } } },
    });
    if (!lead) return { status: 404 as const, error: "客户不存在" };
    const accessFailure = authorizeCustomerDelete(liveActor, lead);
    if (accessFailure) return accessFailure;
    if (lead.customerOrder || lead.repliedOn || lead.followUpCount > 0 || lead.groupStatus !== "NOT_JOINED" || lead.expertIntroducedOn || lead.registeredOn)
      return { status: 400 as const, error: "该客户已有跟进或开单记录，不能删除；请改用编辑号码或标记无效" };
    await recordAudit(transaction, {
      actorId: liveActor.id,
      action: "LEAD_ENTRY_DELETED",
      entityType: "LeadCustomer",
      entityId: lead.id,
      summary: { phone: lead.phone, batchId: lead.batchId, ownerId: lead.ownerId },
    });
    await transaction.leadCustomer.delete({ where: { id: lead.id } });
    return { status: 200 as const };
  });
}
