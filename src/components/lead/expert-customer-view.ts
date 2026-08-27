import type { ExpertCustomer } from "./expert-customer-types";

export function hasActiveOrder(customer: ExpertCustomer) {
  return Boolean(customer.order && !customer.order.voided);
}

export function expertCustomerStage(customer: ExpertCustomer) {
  if (customer.expertWorkflowStage) return customer.expertWorkflowStage;
  if (customer.expertStalledOn) return "STALLED" as const;
  if (hasActiveOrder(customer)) return customer.order && customer.order.rechargeCents > 0 ? "RECHARGING" as const : "FIRST_DEPOSIT" as const;
  if (customer.noInitialDepositOn) return "NO_INITIAL_DEPOSIT" as const;
  if (customer.registeredOn) return "PENDING_ORDER" as const;
  if (customer.expertContactedOn) return "TRACKING" as const;
  return "QUEUED" as const;
}

export function expertCustomerStageLabel(customer: ExpertCustomer) {
  const stage = expertCustomerStage(customer);
  if (stage === "QUEUED") return "排队中";
  if (stage === "MATERIALS") return "交资料";
  if (stage === "TRACKING") return "追踪中";
  if (stage === "PENDING_REGISTRATION") return "待注册";
  if (stage === "PENDING_ORDER") return "待开单";
  if (stage === "DECLINED_DEPOSIT") return "不愿充";
  if (stage === "ORDERED") return "已开单";
  if (stage === "RECHARGING") return "已开单";
  if (stage === "STALLED") return "杀不动";
  if (stage === "NO_INITIAL_DEPOSIT") return "不愿充";
  if (stage === "FIRST_DEPOSIT") return "已开单 · 已首充";
  if (stage === "PENDING_ORDER") return "已注册 · 待开单";
  if (stage === "PENDING_REGISTRATION") return "待注册";
  return "排队中";
}

export function expertCustomerStageClass(customer: ExpertCustomer) {
  const stage = expertCustomerStage(customer);
  if (stage === "QUEUED") return "border-slate-200 bg-slate-50 text-slate-950";
  if (stage === "MATERIALS") return "border-cyan-200 bg-cyan-50 text-slate-950";
  if (stage === "TRACKING") return trackingOverdue(customer) ? "border-rose-300 bg-rose-50 text-rose-800" : "border-blue-200 bg-blue-50 text-slate-950";
  if (stage === "PENDING_REGISTRATION") return "border-violet-200 bg-violet-50 text-slate-950";
  if (stage === "PENDING_ORDER") return "border-amber-200 bg-amber-50 text-slate-950";
  if (stage === "DECLINED_DEPOSIT") return "border-orange-200 bg-orange-50 text-slate-950";
  if (stage === "ORDERED" || stage === "RECHARGING") return "border-emerald-300 bg-emerald-100 text-slate-950";
  if (stage === "STALLED") return "border-rose-200 bg-rose-50 text-slate-950";
  if (stage === "NO_INITIAL_DEPOSIT") return "border-orange-200 bg-orange-50 text-slate-950";
  if (stage === "FIRST_DEPOSIT") return "border-green-200 bg-green-50 text-slate-950";
  if (stage === "PENDING_ORDER") return "border-amber-200 bg-amber-50 text-slate-950";
  if (stage === "PENDING_REGISTRATION") return "border-violet-200 bg-violet-50 text-slate-950";
  return "border-blue-200 bg-blue-50 text-slate-950";
}

export function expertCustomerStagePriority(customer: ExpertCustomer) {
  const stage = expertCustomerStage(customer);
  return stage === "QUEUED" ? 0 : stage === "MATERIALS" ? 1 : stage === "TRACKING" ? 2 : stage === "PENDING_REGISTRATION" ? 3 : stage === "PENDING_ORDER" ? 4 : stage === "DECLINED_DEPOSIT" || stage === "NO_INITIAL_DEPOSIT" ? 5 : stage === "ORDERED" || stage === "FIRST_DEPOSIT" ? 6 : stage === "RECHARGING" ? 7 : 8;
}

export function trackingElapsedHours(customer: ExpertCustomer, now = Date.now()) {
  if (expertCustomerStage(customer) !== "TRACKING" || !customer.expertTrackingStartedAt) return null;
  const startedAt = new Date(customer.expertTrackingStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((now - startedAt) / 3_600_000));
}

export function trackingOverdue(customer: ExpertCustomer, now = Date.now()) {
  const hours = trackingElapsedHours(customer, now);
  return hours !== null && hours >= 48;
}

export function expertCustomerProgress(customer: ExpertCustomer) {
  return expertCustomerStageLabel(customer);
}

export function expertCustomerNextPlan(customer: ExpertCustomer) {
  if (customer.expertStalledOn) return `杀不动：${expertStallReasonLabel(customer.expertStalledReason)}${customer.expertStalledNote ? ` · ${customer.expertStalledNote}` : ""}`;
  if (customer.noInitialDepositOn) return `不首充：${expertStallReasonLabel(customer.noInitialDepositReason)}${customer.noInitialDepositNote ? ` · ${customer.noInitialDepositNote}` : ""}`;
  if (customer.nextPlan) return customer.nextPlan;
  if (customer.order?.voided) return "开单已作废，先核实原因，再决定是否重新开单";
  if (hasActiveOrder(customer)) return "跟进续充；如发生出金，及时登记资金流水";
  if (customer.registeredOn) return "跟进首充，完成后登记开单日期和金额";
  if (customer.expertContactedOn) return "提醒客户完成注册";
  return "确认客户已经联系专家";
}

export function expertCustomerLatestAction(customer: ExpertCustomer) {
  if (customer.expertStalledOn) return `标记杀不动 · ${customer.expertStalledOn}`;
  if (customer.noInitialDepositOn) return `标记不首充 · ${customer.noInitialDepositOn}`;
  if (hasActiveOrder(customer) && customer.order?.latestFinancialOn) return `资金记录 · ${customer.order.latestFinancialOn}`;
  if (customer.lastActivity) return `${customer.lastActivity.occurredOn} · ${customer.lastActivity.actorName}${customer.lastActivity.note ? `：${customer.lastActivity.note}` : ""}`;
  return customer.registeredOn
    ? `完成注册 · ${customer.registeredOn}`
    : customer.expertContactedOn
      ? `联系专家 · ${customer.expertContactedOn}`
      : `推专家 · ${customer.expertIntroducedOn ?? "—"}`;
}

/** 专家只读查看炒群员的最后一条记录，方便接力但不允许在此编辑。 */
export function expertCustomerGroupSituation(customer: ExpertCustomer) {
  const latest = customer.groupProgress?.[0];
  return latest ? `${latest.occurredOn} · ${latest.note}` : "暂无炒群更新";
}

/** 表格里先给员工看进展正文，日期和填写人放在下一行，避免一整串文字挤在一起。 */
export function expertCustomerGroupSituationDisplay(customer: ExpertCustomer) {
  const latest = customer.groupProgress?.[0];
  if (!latest) return { summary: "暂无炒群更新", meta: "", title: "暂无炒群更新" };
  return {
    summary: latest.note,
    meta: `${shortSituationDate(latest.occurredOn)} · ${latest.actorName}`,
    title: expertCustomerGroupSituation(customer),
  };
}

/** 专家侧同样把“做了什么”和“何时、谁填写”分开显示。 */
export function expertCustomerSituationDisplay(customer: ExpertCustomer) {
  const latest = customer.lastActivity;
  const summary = latest?.note?.trim() || expertCustomerProgress(customer);
  const occurredOn = latest?.occurredOn
    ?? customer.expertStalledOn
    ?? customer.noInitialDepositOn
    ?? customer.registeredOn
    ?? customer.expertContactedOn
    ?? customer.expertIntroducedOn;
  const actorName = latest?.actorName ?? customer.expertOwnerName;
  const meta = [occurredOn ? shortSituationDate(occurredOn) : "", actorName ?? "待分配专家"].filter(Boolean).join(" · ");
  return {
    summary,
    meta,
    title: `${occurredOn ?? "—"}${actorName ? ` · ${actorName}` : ""}${summary ? `：${summary}` : ""}`,
  };
}

function shortSituationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : value;
}

export function expertStallReasonLabel(reason: string | null | undefined) {
  if (reason === "NO_RESPONSE") return "客户不回复";
  if (reason === "NO_BUDGET") return "暂时没有资金";
  if (reason === "NO_TRUST") return "不信任 / 仍在观望";
  if (reason === "REFUSED") return "明确拒绝";
  return "其他原因";
}
