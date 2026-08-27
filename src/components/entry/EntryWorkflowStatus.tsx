import type { EntryLead } from "./entry-types";
import { resolveCustomerStage } from "../../lib/customer-stage";
import { expertWorkflowStageLabel, resolveExpertWorkflowStage } from "../../lib/expert-workflow-stage";
import { isReceptionReplyArchived } from "../../lib/reception-reply-queue";

function stageFor(lead: EntryLead) {
  return resolveCustomerStage({
    // “无效粉”在接粉端是资源归类，不是流程终止；仍可继续回复、入群和跟进。
    invalid: false,
    hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
    registeredOn: lead.registeredOn,
    expertIntroducedOn: lead.expertIntroducedOn,
    groupStatus: lead.groupStatus,
    repliedOn: lead.repliedOn,
    followUpCount: lead.followUpCount,
  });
}

export function EntryWorkflowStatus({ lead }: { lead: EntryLead }) {
  const expertStage = resolveExpertWorkflowStage({ ...lead, hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt) });
  if (expertStage) return <span className="member-stage" data-tone={expertStage === "ORDERED" ? "success" : expertStage === "STALLED" ? "warning" : "info"}>{expertWorkflowStageLabel(expertStage)}</span>;
  if (isReceptionReplyArchived(lead)) return <span className="member-stage" data-tone="muted">已归档</span>;
  // 分配设备即表示已经加了客户，但还没有收到回复；不再笼统显示“待联系”。
  if (!lead.repliedOn && lead.device) return <span className="member-stage" data-tone="danger">未回复</span>;
  const stage = stageFor(lead);
  const [label, tone] = stage === "INVALID" ? ["无效", "muted"]
    : stage === "ORDERED" ? ["已开单", "success"]
      : stage === "REGISTERED" ? ["待开单", "info"]
        : stage === "EXPERT_INTRODUCED" ? ["待注册", "info"]
          : stage === "LEFT_GROUP" ? ["已退群", "muted"]
            : stage === "IN_GROUP" ? ["待介绍", "info"]
              : stage === "REPLIED" ? ["待入群", "info"]
                : stage === "FOLLOW_UP" ? [`回访 ${lead.followUpCount} 次`, "warning"]
                  : ["待联系", "warning"];
  return <span className="member-stage" data-tone={tone}>{label}</span>;
}

export function EntryWorkflowNextStep({ lead }: { lead: EntryLead }) {
  const expertStage = resolveExpertWorkflowStage({ ...lead, hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt) });
  if (expertStage) return <span className="member-next-step">{expertStage === "ORDERED" ? "核对资金变化" : "由专家继续推进"}</span>;
  if (lead.receptionArchivedAt) return <span className="member-next-step">已归入未进群归档</span>;
  if (isReceptionReplyArchived(lead)) return <span className="member-next-step">客户回复后可重新进入待入群</span>;
  const stage = stageFor(lead);
  const label = stage === "INVALID" ? "恢复有效"
    : stage === "ORDERED" ? "记资金"
      : stage === "REGISTERED" ? "开单"
        : stage === "EXPERT_INTRODUCED" ? "注册"
          : stage === "LEFT_GROUP" ? "再次入群"
            : stage === "IN_GROUP" ? "推专家"
              : stage === "REPLIED" ? "确认入群"
                : lead.device ? "回访 / 回复" : "填写设备";
  return <span className="member-next-step">{label}</span>;
}
