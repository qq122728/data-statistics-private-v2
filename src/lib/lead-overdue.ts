import { customerStagnationDays, isFollowUpPlanOverdue } from "./customer-follow-up";

export type LeadOverdueInput = {
  id: string;
  phone: string;
  customerName: string | null;
  sourceDate: string;
  channelName: string;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  repliedOn: string | null;
  joinedOn: string | null;
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  registeredOn: string | null;
  nextPlan: string | null;
  nextFollowUpOn: string | null;
  hasActiveOrder: boolean;
  hasTodayGroupProgress: boolean;
  receptionName: string;
  groupOperatorName: string | null;
  expertName: string | null;
};

export type LeadOverdueRow = {
  id: string;
  phone: string;
  customerName: string | null;
  stage: string;
  responsibleRole: string;
  responsibleName: string;
  overdueDays: number;
  reason: string;
  source: string;
  href: string;
  priority: number;
};

function days(from: string | null, today: string) {
  return from ? customerStagnationDays(from, today) ?? 0 : 0;
}

export function classifyLeadOverdue(input: LeadOverdueInput, today: string): LeadOverdueRow | null {
  if (input.groupStatus === "LEFT") return null;

  const base = {
    id: input.id,
    phone: input.phone,
    customerName: input.customerName,
    source: `${input.sourceDate} · ${input.channelName}`,
  };

  if (isFollowUpPlanOverdue(input.nextFollowUpOn, today)) {
    const overdueDays = days(input.nextFollowUpOn, today);
    return {
      ...base,
      stage: "计划逾期",
      responsibleRole: input.expertIntroducedOn ? "专家岗" : input.groupStatus === "JOINED" ? "炒群岗" : "接粉岗",
      responsibleName: input.expertIntroducedOn
        ? input.expertName ?? "待分配专家"
        : input.groupStatus === "JOINED"
          ? input.groupOperatorName ?? "未配置炒群岗"
          : input.receptionName,
      overdueDays,
      reason: input.nextPlan?.trim() || "下一步跟进计划已经过期",
      href: input.expertIntroducedOn ? "/expert-customers" : input.groupStatus === "JOINED" ? "/group-customers" : "/history",
      priority: 0,
    };
  }

  if (input.hasActiveOrder) return null;

  if (input.registeredOn) {
    const overdueDays = days(input.registeredOn, today);
    if (overdueDays < 2) return null;
    return { ...base, stage: "待开单", responsibleRole: "专家岗", responsibleName: input.expertName ?? "待分配专家", overdueDays, reason: "注册超过 48 小时，仍未开单", href: "/expert-customers", priority: 1 };
  }

  if (input.expertContactedOn) {
    const overdueDays = days(input.expertContactedOn, today);
    if (overdueDays < 2) return null;
    return { ...base, stage: "待注册", responsibleRole: "专家岗", responsibleName: input.expertName ?? "待分配专家", overdueDays, reason: "专家已联系超过 48 小时，仍未注册", href: "/expert-customers", priority: 2 };
  }

  if (input.expertIntroducedOn) {
    const overdueDays = days(input.expertIntroducedOn, today);
    if (overdueDays < 1) return null;
    return { ...base, stage: "已推专家待联系", responsibleRole: "炒群岗", responsibleName: input.groupOperatorName ?? "未配置炒群岗", overdueDays, reason: "推专家超过 24 小时，仍未由炒群岗确认客户已联系专家", href: "/group-customers", priority: 3 };
  }

  if (input.groupStatus === "JOINED") {
    if (input.hasTodayGroupProgress) return null;
    const overdueDays = Math.max(1, days(input.joinedOn, today));
    return { ...base, stage: "群内进度未填", responsibleRole: "炒群岗", responsibleName: input.groupOperatorName ?? "未配置炒群岗", overdueDays, reason: "今天还没有填写群内进度", href: "/group-customers", priority: 4 };
  }

  if (input.repliedOn) {
    const overdueDays = days(input.repliedOn, today);
    if (overdueDays < 1) return null;
    return { ...base, stage: "待入群", responsibleRole: "接粉岗", responsibleName: input.receptionName, overdueDays, reason: "回复超过 24 小时，仍未确认入群", href: "/history", priority: 5 };
  }

  const overdueDays = days(input.sourceDate, today);
  if (overdueDays < 1) return null;
  return { ...base, stage: "待回复", responsibleRole: "接粉岗", responsibleName: input.receptionName, overdueDays, reason: "提交号码超过 24 小时，仍未回复", href: "/history", priority: 6 };
}

export function buildLeadOverdueRows(inputs: LeadOverdueInput[], today: string): LeadOverdueRow[] {
  return inputs
    .map((input) => classifyLeadOverdue(input, today))
    .filter((row): row is LeadOverdueRow => row !== null)
    .sort((left, right) => left.priority - right.priority || right.overdueDays - left.overdueDays || left.phone.localeCompare(right.phone));
}
