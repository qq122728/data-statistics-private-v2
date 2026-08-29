import type { LeadActivityKind, LeadGroupStatus } from "@prisma/client";
import type { CustomerWorkflowInput } from "./input";

type WorkflowLeadState = {
  invalid: boolean;
  isHistoricalRecord?: boolean;
  historicalBaselineStage?: string | null;
  deviceId: string | null;
  repliedOn: string | null;
  followUpCount: number;
  groupStatus: LeadGroupStatus;
  joinedOn: string | null;
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  expertStalledOn?: string | null;
  noInitialDepositOn?: string | null;
  registeredOn: string | null;
  receptionArchivedAt?: Date | null;
  customerOrder: { voidedAt: Date | null } | null;
};

type BasicMutation = {
  update: Record<string, unknown>;
  activityKind?: LeadActivityKind;
  activityNote?: string;
};

type MutationFailure = { status: 400; error: string };

const historicalStageRank: Record<string, number> = { NOT_REPLIED: 0, REPLIED: 1, JOINED: 2, INTRODUCED: 3, REGISTERED: 4 };
function baselineIncludes(lead: WorkflowLeadState, stage: keyof typeof historicalStageRank) {
  return Boolean(lead.isHistoricalRecord && historicalStageRank[lead.historicalBaselineStage ?? ""] >= historicalStageRank[stage]);
}

function stallReasonLabel(reason: CustomerWorkflowInput["stalledReason"]) {
  if (reason === "NO_RESPONSE") return "客户不回复";
  if (reason === "NO_BUDGET") return "暂时没有资金";
  if (reason === "NO_TRUST") return "不信任 / 仍在观望";
  if (reason === "REFUSED") return "明确拒绝";
  return "其他原因";
}

export function buildBasicCustomerMutation(
  input: CustomerWorkflowInput,
  lead: WorkflowLeadState,
  occurredOn: string,
): BasicMutation | MutationFailure | null {
  // 无效库客户不回到日常待处理队列，但接粉员可以补记“已回复、已入群”，
  // 让炒群岗位知晓实际情况。无效库客户不允许进入专家和业绩链路。
  if (lead.invalid && input.action === "followUp")
    return { status: 400, error: "无效库客户不能累计回访；如需继续常规跟进，请先恢复有效" };
  if (lead.invalid && ["introduceExpert", "markExpertContacted", "beginExpertReception", "beginExpertTracking", "markPendingRegistration", "register", "markExpertStalled", "markNoInitialDeposit", "updateExpertDetails", "voidOrder"].includes(input.action))
    return { status: 400, error: "无效库转入客户仅供炒群记录，不进入专家和业绩流程" };

  // 回复、入群这两步允许改判无效——需求文档3.1.1明确这类客户跟进过程中
  // 才发现金额不足/无WS是常见场景，无效库客户本来就还能继续回复、入群
  // （见上面两条 invalid 分支），改判本身不影响这些操作。但一旦进入专家
  // 环节或已开单，改判无效会连带把后续专家操作也锁死（见上面的 invalid
  // 阻断列表），这是真实的功能冲突，必须继续禁止。
  const hasExpertOrOrderProgress = Boolean(
    lead.expertIntroducedOn ||
    lead.expertContactedOn ||
    lead.registeredOn ||
    (lead.customerOrder && !lead.customerOrder.voidedAt),
  );

  switch (input.action) {
    case "voidErroneousEntry":
      if (hasExpertOrOrderProgress)
        return { status: 400, error: "客户已进入专家跟进或开单流程，不能按误录作废；请使用对应流程的纠错功能" };
      // 已产生回复、入群或专家记录时不能物理删除；保留历史供管理员
      // 核对，但将误录客户从所有有效转化和业绩口径中排除。
      return {
        update: { invalid: true, invalidReason: `误录作废：${input.reason || "未填写原因"}`, receptionCategory: "INVALID" },
        activityKind: "MARKED_INVALID",
        activityNote: `误录作废：${input.reason || "未填写原因"}`,
      };
    case "restoreValid":
      return {
        update: { invalid: false, invalidReason: null, receptionCategory: "VALID" },
        activityKind: "RESTORED_VALID",
      };
    case "classifyReception": {
      if (!input.receptionCategory)
        return { status: 400, error: "请选择低金额或无 WS 号码" };
      if (input.receptionCategory !== "VALID" && hasExpertOrOrderProgress)
        return { status: 400, error: "客户已进入专家跟进流程，不能改为低金额或无 WS 客户" };
      if (input.receptionCategory === "LOW_AMOUNT") {
        if (input.lossAmountCents === undefined || input.lossAmountCents === null)
          return { status: 400, error: "低金额必须填写客户金额" };
        if (input.lossAmountCents >= 500_000)
          return { status: 400, error: "低金额必须低于 $5,000" };
        return {
          update: {
            receptionCategory: "LOW_AMOUNT",
            invalid: true,
            invalidReason: "低金额（低于 $5,000）",
            lossAmountCents: input.lossAmountCents,
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          },
          activityKind: "MARKED_INVALID",
          activityNote: `归类为低金额：${input.lossAmountCents / 100} 美元`,
        };
      }
      if (input.receptionCategory === "NO_WS") {
        return {
          update: {
            receptionCategory: "NO_WS",
            invalid: true,
            invalidReason: "无 WS 号码",
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          },
          activityKind: "MARKED_INVALID",
          activityNote: input.notes || "归类为无 WS 号码",
        };
      }
      return {
        update: {
          receptionCategory: "VALID",
          invalid: false,
          invalidReason: null,
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        },
        activityKind: "RESTORED_VALID",
        activityNote: "归类为有效数据",
      };
    }
    case "followUp":
      if (!lead.deviceId) return { status: 400, error: "请先分配联系设备" };
      if (lead.repliedOn) return { status: 400, error: "该客户已回复，无需继续累计回访" };
      return {
        update: { followUpCount: { increment: 1 }, lastFollowedUpOn: occurredOn },
        activityKind: "FOLLOWED_UP",
      };
    case "reply":
      if (!lead.deviceId) return { status: 400, error: "请先分配联系设备" };
      if (lead.repliedOn) return { status: 400, error: "该客户已经标记为回复" };
      return {
        update: { replyStatus: "REPLIED", repliedOn: occurredOn, ...(lead.isHistoricalRecord ? { historicalReplyCounted: true } : {}) },
        activityKind: "REPLIED",
        activityNote: "标记已回复",
      };
    case "undoReply":
      if (!lead.repliedOn) return { status: 400, error: "该客户当前未标记回复，不能撤销" };
      if (baselineIncludes(lead, "REPLIED")) return { status: 400, error: "该回复属于启用前历史底账，不能撤销" };
      if (lead.receptionArchivedAt) return { status: 400, error: "客户已归档，不能直接撤销回复" };
      if (lead.groupStatus !== "NOT_JOINED" || lead.expertIntroducedOn || lead.registeredOn || (lead.customerOrder && !lead.customerOrder.voidedAt))
        return { status: 400, error: "客户已进入拉群、专家或开单流程，不能撤销回复" };
      return {
        update: { replyStatus: "NOT_REPLIED", repliedOn: null, ...(lead.isHistoricalRecord ? { historicalReplyCounted: false } : {}) },
        activityKind: "REPLY_UNDONE",
        activityNote: `撤销回复：${input.reason?.trim() || "未填写原因"}`,
      };
    case "updateReceptionChatStatus":
      if (!lead.repliedOn) return { status: 400, error: "客户回复后才能修改聊天状态" };
      if (lead.groupStatus !== "NOT_JOINED") return { status: 400, error: "客户已进入群流程，不能修改待入群状态" };
      if (lead.receptionArchivedAt) return { status: 400, error: "客户已归档，不能修改聊天状态" };
      return {
        update: { receptionChatStatus: input.receptionChatStatus, receptionStatusChangedAt: new Date() },
        activityKind: "RECEPTION_STATUS_UPDATED",
        activityNote: input.receptionChatStatus === "READY_TO_JOIN" ? "状态改为准备拉群" : "状态改为正常聊天",
      };
    case "archiveRepliedCustomer":
      if (!lead.repliedOn) return { status: 400, error: "只有已回复但未进群的客户可以手动归档" };
      if (lead.groupStatus !== "NOT_JOINED") return { status: 400, error: "客户已进入群流程，不能归档为未进群" };
      if (lead.receptionArchivedAt) return { status: 400, error: "客户已经归档" };
      return {
        update: {
          receptionArchivedAt: new Date(),
          receptionArchiveReason: input.reason!.trim(),
          receptionArchiveVisitCount: input.archiveVisitCount,
          receptionChatStatus: "NORMAL_CHAT",
          receptionStatusChangedAt: new Date(),
        },
        activityKind: "RECEPTION_ARCHIVED",
        activityNote: `未进群归档：${input.reason!.trim()}；回访 ${input.archiveVisitCount} 次`,
      };
    case "joinGroup":
      if (!lead.repliedOn) return { status: 400, error: "客户回复后才能确认入群" };
      if (lead.groupStatus === "JOINED") return { status: 400, error: "客户已经在群内" };
      if (lead.receptionArchivedAt) return { status: 400, error: "客户已归档，不能确认入群" };
      return {
        update: { groupStatus: "JOINED", joinedOn: occurredOn, leftOn: null, leftWithOrder: null, leftNote: null, leftAutomatically: false, receptionChatStatus: "NORMAL_CHAT", receptionStatusChangedAt: new Date(), ...(lead.isHistoricalRecord ? { historicalJoinCounted: true, historicalLeaveCounted: false } : {}) },
        activityKind: "JOINED_GROUP",
      };
    case "leaveGroup":
      if (lead.groupStatus !== "JOINED") return { status: 400, error: "只有群内客户可以退群" };
      if (!lead.joinedOn) return { status: 400, error: "客户缺少入群日期，请先修正入群记录" };
      if (occurredOn < lead.joinedOn) return { status: 400, error: "退群日期不能早于入群日期" };
      return {
        update: { groupStatus: "LEFT", leftOn: occurredOn, leftWithOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt), leftNote: input.leaveNote?.trim() || null, leftAutomatically: false, ...(lead.isHistoricalRecord ? { historicalLeaveCounted: true } : {}) },
        activityKind: "LEFT_GROUP",
        activityNote: input.leaveNote?.trim() ? `退群备注：${input.leaveNote.trim()}` : "已标记退群",
      };
    case "undoJoinGroup":
      if (lead.groupStatus !== "JOINED") return { status: 400, error: "该客户当前不在群内，不能撤销入群" };
      if (baselineIncludes(lead, "JOINED")) return { status: 400, error: "该入群属于启用前历史底账，不能撤销" };
      if (lead.expertIntroducedOn || lead.registeredOn || (lead.customerOrder && !lead.customerOrder.voidedAt))
        return { status: 400, error: "该客户已有后续记录，请先撤销后续步骤" };
      return {
        update: { groupStatus: "NOT_JOINED", joinedOn: null, leftOn: null, leftWithOrder: null, leftNote: null, leftAutomatically: false, ...(lead.isHistoricalRecord ? { historicalJoinCounted: false, historicalLeaveCounted: false } : {}) },
        activityKind: "GROUP_JOIN_REVOKED",
      };
    case "undoLeaveGroup":
      if (lead.groupStatus !== "LEFT") return { status: 400, error: "该客户没有退群记录，不能撤销" };
      return {
        update: { groupStatus: "JOINED", leftOn: null, leftWithOrder: null, leftNote: null, leftAutomatically: false, ...(lead.isHistoricalRecord ? { historicalLeaveCounted: false } : {}) },
        activityKind: "GROUP_LEAVE_REVOKED",
      };
    case "register":
      if (lead.groupStatus === "NOT_JOINED" || !lead.expertIntroducedOn)
        return { status: 400, error: "客户进过群且推专家后才能标记注册" };
      if (!lead.expertContactedOn) return { status: 400, error: "请先确认客户已经联系专家" };
      if (occurredOn < lead.expertContactedOn) return { status: 400, error: "注册日期不能早于专家联系日期" };
      if (lead.registeredOn) return { status: 400, error: "该客户已注册" };
      return { update: { registeredOn: occurredOn, ...(lead.isHistoricalRecord ? { historicalRegistrationCounted: true } : {}) }, activityKind: "REGISTERED" };
    case "markExpertStalled":
      if (!lead.expertIntroducedOn) return { status: 400, error: "请先推专家后再标记杀不动" };
      if (!lead.customerOrder || lead.customerOrder.voidedAt) return { status: 400, error: "只有已开单客户才能标记杀不动" };
      if (lead.expertStalledOn) return { status: 400, error: "该客户已经在杀不动名单中" };
      if (!input.stalledReason) return { status: 400, error: "请选择杀不动原因" };
      if (input.stalledReason === "OTHER" && !input.stalledNote?.trim()) return { status: 400, error: "选择其他原因时请填写说明" };
      return {
        update: { expertStalledOn: occurredOn, expertStalledReason: input.stalledReason, expertStalledNote: input.stalledNote?.trim() || null },
        activityKind: "PLAN_UPDATED",
        activityNote: `标记杀不动：${stallReasonLabel(input.stalledReason)}${input.stalledNote?.trim() ? `；${input.stalledNote.trim()}` : ""}`,
      };
    case "markNoInitialDeposit":
      if (!lead.registeredOn) return { status: 400, error: "客户注册后才能标记不首充" };
      if (lead.customerOrder && !lead.customerOrder.voidedAt) return { status: 400, error: "客户已经开单，不能标记不首充" };
      if (lead.noInitialDepositOn) return { status: 400, error: "该客户已经标记为不首充" };
      if (!input.noInitialDepositReason) return { status: 400, error: "请选择不首充原因" };
      if (input.noInitialDepositReason === "OTHER" && !input.noInitialDepositNote?.trim()) return { status: 400, error: "选择其他原因时请填写说明" };
      return {
        update: { noInitialDepositOn: occurredOn, noInitialDepositReason: input.noInitialDepositReason, noInitialDepositNote: input.noInitialDepositNote?.trim() || null },
        activityKind: "PLAN_UPDATED",
        activityNote: `标记不首充：${stallReasonLabel(input.noInitialDepositReason)}${input.noInitialDepositNote?.trim() ? `；${input.noInitialDepositNote.trim()}` : ""}`,
      };
    case "clearExpertStalled":
      if (!lead.expertStalledOn) return { status: 400, error: "该客户不在杀不动名单中" };
      return {
        update: { expertStalledOn: null, expertStalledReason: null, expertStalledNote: null },
        activityKind: "PLAN_UPDATED",
        activityNote: "已恢复到专家跟进",
      };
    case "clearNoInitialDeposit":
      if (!lead.noInitialDepositOn) return { status: 400, error: "该客户未标记不首充" };
      return {
        update: { noInitialDepositOn: null, noInitialDepositReason: null, noInitialDepositNote: null },
        activityKind: "PLAN_UPDATED",
        activityNote: "已恢复首充跟进",
      };
    case "undoIntroduceExpert":
      if (!lead.expertIntroducedOn) return { status: 400, error: "该客户没有推专家记录" };
      if (baselineIncludes(lead, "INTRODUCED")) return { status: 400, error: "该推专家记录属于启用前历史底账，不能撤销" };
      if (lead.registeredOn || (lead.customerOrder && !lead.customerOrder.voidedAt))
        return { status: 400, error: "该客户已有注册或开单记录，请先撤销后续步骤" };
      return {
        update: { expertIntroducedOn: null, expertOwnerId: null, expertDeviceAccountId: null, expertDeviceAccountNumber: null, expertContactedOn: null, expertContactNote: null, ...(lead.isHistoricalRecord ? { historicalExpertIntroCounted: false } : {}) },
        activityKind: "EXPERT_INTRO_REVOKED",
      };
    case "undoExpertContacted":
      if (!lead.expertContactedOn) return { status: 400, error: "该客户还没有已联系记录" };
      if (lead.registeredOn || (lead.customerOrder && !lead.customerOrder.voidedAt))
        return { status: 400, error: "该客户已有注册或开单记录，请先撤销后续步骤" };
      return {
        update: { expertContactedOn: null, expertContactNote: null },
        activityKind: "EXPERT_CONTACT_REVOKED",
      };
    case "undoRegister":
      if (!lead.registeredOn) return { status: 400, error: "该客户没有注册记录" };
      if (baselineIncludes(lead, "REGISTERED")) return { status: 400, error: "该注册属于启用前历史底账，不能撤销" };
      if (lead.customerOrder && !lead.customerOrder.voidedAt)
        return { status: 400, error: "该客户已经开单，请先作废开单记录" };
      return { update: { registeredOn: null, ...(lead.isHistoricalRecord ? { historicalRegistrationCounted: false } : {}) }, activityKind: "REGISTRATION_REVOKED" };
    case "note":
      return { update: { notes: input.notes || null } };
    case "updateProfile":
      // 导入时未填金额的客户，后续补资料时也要遵守同一条低金额规则。
      // 已进入专家环节的客户不能被接粉员突然移出流程，避免专家正在
      // 跟进时被锁死后续操作；回复、入群阶段允许改判（见上方注释）。
      if (input.lossAmountCents !== undefined && input.lossAmountCents !== null && input.lossAmountCents < 500_000) {
        if (hasExpertOrOrderProgress)
          return { status: 400, error: "客户已进入专家跟进流程，不能改为低金额客户" };
        return {
          update: {
            ...(input.customerName !== undefined ? { customerName: input.customerName || null } : {}),
            ...(input.customerEmail !== undefined ? { customerEmail: input.customerEmail.toLowerCase() || null } : {}),
            lossAmountCents: input.lossAmountCents,
            ...(input.customerPlatform !== undefined ? { customerPlatform: input.customerPlatform || null } : {}),
            ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
            receptionCategory: "LOW_AMOUNT",
            invalid: true,
            invalidReason: "低金额（低于 $5,000）",
          },
          activityKind: "MARKED_INVALID",
          activityNote: `补充资料后自动归类为低金额：${input.lossAmountCents / 100} 美元`,
        };
      }
      return {
        update: {
          ...(input.customerName !== undefined ? { customerName: input.customerName || null } : {}),
          ...(input.customerEmail !== undefined ? { customerEmail: input.customerEmail.toLowerCase() || null } : {}),
          ...(input.lossAmountCents !== undefined ? { lossAmountCents: input.lossAmountCents } : {}),
          ...(input.customerPlatform !== undefined ? { customerPlatform: input.customerPlatform || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        },
      };
    case "updateGroupDetails":
      return {
        update: {
          ...(input.customerName !== undefined ? { customerName: input.customerName.trim() || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
        },
        activityKind: "PLAN_UPDATED",
        activityNote: "已更新群客户资料",
      };
    case "updateExpertDetails": {
      const activityNote = [
        input.expertNotes?.trim() ? `专家情况：${input.expertNotes.trim()}` : null,
        input.nextPlan?.trim() ? `下一步：${input.nextPlan.trim()}` : "已更新专家客户资料",
        input.nextFollowUpOn ? `计划日期：${input.nextFollowUpOn}` : null,
      ].filter(Boolean).join("；");
      return {
        update: {
          ...(input.customerName !== undefined ? { customerName: input.customerName.trim() || null } : {}),
          ...(input.expertNotes !== undefined ? { expertNotes: input.expertNotes.trim() || null } : {}),
          ...(input.nextPlan !== undefined ? { nextPlan: input.nextPlan.trim() || null } : {}),
          ...(input.nextFollowUpOn !== undefined ? { nextFollowUpOn: input.nextFollowUpOn || null } : {}),
        },
        activityKind: "PLAN_UPDATED",
        activityNote,
      };
    }
    default:
      return null;
  }
}
