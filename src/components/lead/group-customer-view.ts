import { resolveCustomerStage } from "../../lib/customer-stage";
import { expertWorkflowStageLabel, resolveExpertWorkflowStage } from "../../lib/expert-workflow-stage";
import type { GroupCustomer } from "./group-customer-types";

export function groupCustomerStage(customer: GroupCustomer) {
  const expertStage = resolveExpertWorkflowStage({ ...customer, hasActiveOrder: Boolean(customer.order && !customer.order.voided) });
  if (expertStage) return expertWorkflowStageLabel(expertStage);
  const current = resolveCustomerStage({
    hasActiveOrder: Boolean(customer.order && !customer.order.voided),
    registeredOn: customer.registeredOn,
    expertContactedOn: customer.expertContactedOn,
    expertIntroducedOn: customer.expertIntroducedOn,
    groupStatus: customer.groupStatus,
    repliedOn: customer.repliedOn,
    followUpCount: customer.followUpCount,
  });
  if (current === "ORDERED") return "已开单";
  if (current === "REGISTERED") return "已注册待开单";
  if (current === "EXPERT_CONTACTED") return "专家已联系待注册";
  if (current === "EXPERT_INTRODUCED") return "已推专家待联系";
  return customer.groupStatus === "LEFT" ? "已退群待推专家" : "在群待推专家";
}

export function groupCustomerStageClass(customer: GroupCustomer) {
  const stage = groupCustomerStage(customer);
  if (stage === "已开单") return "border-emerald-200 bg-emerald-50 text-slate-950";
  if (stage === "杀不动") return "border-rose-200 bg-rose-50 text-slate-950";
  if (stage === "不愿充") return "border-orange-200 bg-orange-50 text-slate-950";
  if (stage === "排队中") return "border-slate-200 bg-slate-50 text-slate-950";
  if (stage === "交资料") return "border-cyan-200 bg-cyan-50 text-slate-950";
  if (stage === "追踪中") return "border-blue-200 bg-blue-50 text-slate-950";
  if (stage === "已注册待开单") return "border-amber-200 bg-amber-50 text-slate-950";
  if (stage === "专家已联系待注册") return "border-violet-200 bg-violet-50 text-slate-950";
  if (stage === "已推专家待联系") return "border-fuchsia-200 bg-fuchsia-50 text-slate-950";
  return customer.groupStatus === "LEFT" ? "border-slate-200 bg-slate-100 text-slate-950" : "border-blue-200 bg-blue-50 text-slate-950";
}

/** 待处理的客户排在最上面；员工无需手动排序。 */
export function groupCustomerStagePriority(customer: GroupCustomer) {
  const stage = groupCustomerStage(customer);
  if (stage === "在群待推专家" || stage === "已退群待推专家") return 0;
  if (stage === "排队中") return 1;
  if (stage === "交资料") return 2;
  if (stage === "追踪中") return 3;
  if (stage === "待注册") return 4;
  if (stage === "待开单") return 5;
  if (stage === "不愿充") return 6;
  if (stage === "杀不动") return 7;
  return 4;
}

export function groupCustomerNet(customer: GroupCustomer) {
  if (!customer.order || customer.order.voided) return 0;
  return customer.order.initialDepositCents + customer.order.rechargeCents - customer.order.withdrawalCents;
}

/** 炒群员每日填写的进度是独立记录，不使用客户公共备注。 */
export function groupCustomerSituation(customer: GroupCustomer) {
  const latest = customer.groupProgress[0];
  return latest ? `${latest.occurredOn} · ${latest.note}` : "—";
}

/** 炒群进展在表格中分两行展示，正文比日期更优先。 */
export function groupCustomerSituationDisplay(customer: GroupCustomer) {
  const latest = customer.groupProgress[0];
  if (!latest) return { summary: "暂无炒群更新", meta: "", title: "暂无炒群更新" };
  return {
    summary: latest.note,
    meta: `${shortSituationDate(latest.occurredOn)} · ${latest.actorName}`,
    title: groupCustomerSituation(customer),
  };
}

/** 专家情况只读取专家负责的字段，避免与炒群情况或客户公共备注混在一起。 */
export function groupCustomerExpertSituation(customer: GroupCustomer) {
  const stage = resolveExpertWorkflowStage({ ...customer, hasActiveOrder: Boolean(customer.order && !customer.order.voided) });
  if (customer.expertStalledOn) return `杀不动：${customer.expertStalledNote || customer.expertStalledReason || "未填写说明"}`;
  if (customer.noInitialDepositOn) return `不首充：${customer.noInitialDepositNote || customer.noInitialDepositReason || "未填写说明"}`;
  if (customer.expertNotes) return customer.expertNotes;
  if (customer.nextPlan) return `下一步：${customer.nextPlan}`;
  if (customer.expertContactNote) return customer.expertContactNote;
  if (customer.registeredOn) return `已注册 · ${customer.registeredOn}`;
  if (customer.expertContactedOn) return `${expertWorkflowStageLabel(stage)} · ${customer.expertContactedOn}`;
  return stage ? expertWorkflowStageLabel(stage) : "尚未推专家";
}

/** 组长和管理层查看开单客户时，也用同一套“正文＋填写来源”格式核对专家情况。 */
export function groupCustomerExpertSituationDisplay(customer: GroupCustomer) {
  const summary = groupCustomerExpertSituation(customer);
  const occurredOn = customer.expertStalledOn
    ?? customer.noInitialDepositOn
    ?? customer.registeredOn
    ?? customer.expertContactedOn
    ?? customer.expertIntroducedOn;
  const actorName = customer.expertOwnerName ?? "待分配专家";
  return {
    summary,
    meta: [occurredOn ? shortSituationDate(occurredOn) : "", actorName].filter(Boolean).join(" · "),
    title: `${occurredOn ?? "—"} · ${actorName}：${summary}`,
  };
}

function shortSituationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : value;
}
