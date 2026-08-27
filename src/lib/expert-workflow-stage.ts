/** 所有岗位共用同一份专家阶段解释，避免接粉、炒群、专家各自显示不同文案。 */
export type ExpertWorkflowStage = "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED";

export type ExpertWorkflowStageInput = {
  expertWorkflowStage?: ExpertWorkflowStage | null;
  expertIntroducedOn?: string | null;
  expertContactedOn?: string | null;
  expertTrackingStartedAt?: Date | string | null;
  registeredOn?: string | null;
  noInitialDepositOn?: string | null;
  expertStalledOn?: string | null;
  hasActiveOrder?: boolean;
};

export function resolveExpertWorkflowStage(input: ExpertWorkflowStageInput): ExpertWorkflowStage | null {
  if (input.expertWorkflowStage) return input.expertWorkflowStage;
  if (!input.expertIntroducedOn) return null;
  // 兼容新字段上线前的历史客户，确保旧客户也能进入统一展示。
  if (input.expertStalledOn) return "STALLED";
  if (input.hasActiveOrder) return "ORDERED";
  if (input.noInitialDepositOn) return "DECLINED_DEPOSIT";
  if (input.registeredOn) return "PENDING_ORDER";
  if (input.expertContactedOn) return "TRACKING";
  return "QUEUED";
}

export function expertWorkflowStageLabel(stage: ExpertWorkflowStage | null) {
  if (stage === "QUEUED") return "排队中";
  if (stage === "MATERIALS") return "交资料";
  if (stage === "TRACKING") return "追踪中";
  if (stage === "PENDING_REGISTRATION") return "待注册";
  if (stage === "PENDING_ORDER") return "待开单";
  if (stage === "DECLINED_DEPOSIT") return "不愿充";
  if (stage === "ORDERED") return "已开单";
  if (stage === "STALLED") return "杀不动";
  return "尚未推专家";
}

export function expertWorkflowTrackingHours(input: ExpertWorkflowStageInput, now = Date.now()) {
  if (resolveExpertWorkflowStage(input) !== "TRACKING" || !input.expertTrackingStartedAt) return null;
  const startedAt = new Date(input.expertTrackingStartedAt).getTime();
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((now - startedAt) / 3_600_000));
}

export function expertWorkflowTrackingOverdue(input: ExpertWorkflowStageInput, now = Date.now()) {
  const hours = expertWorkflowTrackingHours(input, now);
  return hours !== null && hours >= 48;
}
