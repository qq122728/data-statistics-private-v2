import { conversionRatePercent, gradeConversion, type ConversionGrade, type GroupConversionStandards, type RateBand } from "./conversion-standards";
import { customerStagnationDays } from "./customer-follow-up";

export type LeadManagementInput = {
  sourceDate: string;
  /** 这三类可继续跟进，但不能计为有效数据。 */
  receptionCategory?: "PENDING" | "VALID" | "INVALID" | "LOW_AMOUNT" | "NO_WS";
  invalid?: boolean;
  repliedOn: string | null;
  joinedOn: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  expertOwnerId: string | null;
  registeredOn: string | null;
  hasTodayGroupProgress: boolean;
  hasActiveOrder: boolean;
  abnormalFinance: boolean;
};

export type LeadRoleGradeCard = {
  key: "reception" | "operator" | "expert";
  label: string;
  metricLabel: string;
  completed: number;
  eligible: number;
  rate: number | null;
  grade: ConversionGrade;
  band: RateBand;
  href: string;
  note: string;
};

export type LeadBottleneckRow = {
  key: string;
  role: "接粉岗" | "炒群岗" | "专家岗" | "资金";
  label: string;
  eligible: number;
  completed: number;
  overdue: number;
  completionRate: number | null;
  longestOverdueDays: number;
  status: "NORMAL" | "WARNING" | "DANGER" | "NO_SAMPLE";
  href: string;
  rule: string;
};

const days = (value: string | null, today: string) => value ? customerStagnationDays(value, today) ?? 0 : 0;

function row(input: {
  key: string;
  role: LeadBottleneckRow["role"];
  label: string;
  candidates: LeadManagementInput[];
  completed: (lead: LeadManagementInput) => boolean;
  age: (lead: LeadManagementInput) => number;
  href: string;
  rule: string;
}): LeadBottleneckRow {
  const completed = input.candidates.filter(input.completed).length;
  const overdueLeads = input.candidates.filter((lead) => !input.completed(lead));
  const longestOverdueDays = overdueLeads.reduce((maximum, lead) => Math.max(maximum, input.age(lead)), 0);
  const status = input.candidates.length === 0
    ? "NO_SAMPLE"
    : overdueLeads.length === 0
      ? "NORMAL"
      : longestOverdueDays >= 3
        ? "DANGER"
        : "WARNING";
  return {
    key: input.key,
    role: input.role,
    label: input.label,
    eligible: input.candidates.length,
    completed,
    overdue: overdueLeads.length,
    completionRate: conversionRatePercent(completed, input.candidates.length),
    longestOverdueDays,
    status,
    href: input.href,
    rule: input.rule,
  };
}

export function buildLeadManagementSummary(leads: LeadManagementInput[], today: string, standards: GroupConversionStandards): { cards: LeadRoleGradeCard[]; bottlenecks: LeadBottleneckRow[] } {
  const effectiveReceptionLeads = leads.filter((lead) => !lead.invalid && !["INVALID", "LOW_AMOUNT", "NO_WS"].includes(lead.receptionCategory ?? "VALID"));
  const receptionCompleted = effectiveReceptionLeads.filter((lead) => Boolean(lead.joinedOn)).length;
  const operatorEligible = leads.filter((lead) => lead.groupStatus === "JOINED" && days(lead.joinedOn, today) >= 2);
  const operatorCompleted = operatorEligible.filter((lead) => Boolean(lead.expertIntroducedOn)).length;
  const expertEligible = leads.filter((lead) => Boolean(lead.expertOwnerId && lead.expertIntroducedOn) && days(lead.expertIntroducedOn, today) >= 1);
  const expertCompleted = expertEligible.filter((lead) => lead.hasActiveOrder).length;
  const card = (value: Omit<LeadRoleGradeCard, "rate" | "grade">): LeadRoleGradeCard => ({
    ...value,
    rate: conversionRatePercent(value.completed, value.eligible),
    grade: gradeConversion(value.completed, value.eligible, value.band),
  });
  const cards: LeadRoleGradeCard[] = [
    card({ key: "reception", label: "接粉岗", metricLabel: "有效数据入群率", completed: receptionCompleted, eligible: effectiveReceptionLeads.length, band: standards.receptionJoin, href: "/history", note: "已进群 ÷ 有效数据" }),
    card({ key: "operator", label: "炒群岗", metricLabel: "第3天推专家率", completed: operatorCompleted, eligible: operatorEligible.length, band: standards.operatorExpert, href: "/group-customers", note: "已推专家 ÷ 进入第3天的在群客户" }),
    card({ key: "expert", label: "专家岗", metricLabel: "第2天开单率", completed: expertCompleted, eligible: expertEligible.length, band: standards.expertOrder, href: "/expert-customers", note: "已开单 ÷ 接手进入第2天的客户" }),
  ];

  const replyDue = leads.filter((lead) => days(lead.sourceDate, today) >= 1);
  const joinDue = leads.filter((lead) => Boolean(lead.repliedOn) && days(lead.repliedOn, today) >= 1);
  const groupProgressDue = leads.filter((lead) => lead.groupStatus === "JOINED" && !lead.expertIntroducedOn);
  const expertIntroDue = leads.filter((lead) => lead.groupStatus === "JOINED" && days(lead.joinedOn, today) >= 2);
  const contactDue = leads.filter((lead) => Boolean(lead.expertOwnerId && lead.expertIntroducedOn) && days(lead.expertIntroducedOn, today) >= 1);
  const registrationDue = leads.filter((lead) => Boolean(lead.expertContactedOn) && days(lead.expertContactedOn, today) >= 2);
  const orderDue = leads.filter((lead) => Boolean(lead.registeredOn) && days(lead.registeredOn, today) >= 2);
  const assignmentDue = leads.filter((lead) => Boolean(lead.expertIntroducedOn));
  const financeDue = leads.filter((lead) => lead.abnormalFinance);

  const bottlenecks: LeadBottleneckRow[] = [
    row({ key: "reply", role: "接粉岗", label: "首次回复", candidates: replyDue, completed: (lead) => Boolean(lead.repliedOn), age: (lead) => Math.max(1, days(lead.sourceDate, today) - 1), href: "/history", rule: "提交号码进入第2天仍未回复" }),
    row({ key: "join", role: "接粉岗", label: "推动入群", candidates: joinDue, completed: (lead) => Boolean(lead.joinedOn), age: (lead) => Math.max(1, days(lead.repliedOn, today) - 1), href: "/history", rule: "回复进入第2天仍未入群" }),
    row({ key: "progress", role: "炒群岗", label: "今日群内进度", candidates: groupProgressDue, completed: (lead) => lead.hasTodayGroupProgress, age: () => 1, href: "/group-customers", rule: "当前在群客户今天应填写进度" }),
    row({ key: "intro", role: "炒群岗", label: "第3天推专家", candidates: expertIntroDue, completed: (lead) => Boolean(lead.expertIntroducedOn), age: (lead) => Math.max(1, days(lead.joinedOn, today) - 1), href: "/group-customers", rule: "进群第3天开始进入推专家考核" }),
    row({ key: "assignment", role: "专家岗", label: "分配专家负责人", candidates: assignmentDue, completed: (lead) => Boolean(lead.expertOwnerId), age: (lead) => days(lead.expertIntroducedOn, today), href: "/expert-customers", rule: "推专家后应明确负责人" }),
    row({ key: "contact", role: "专家岗", label: "专家联系", candidates: contactDue, completed: (lead) => Boolean(lead.expertContactedOn), age: (lead) => Math.max(1, days(lead.expertIntroducedOn, today) - 1), href: "/expert-customers", rule: "接手进入第2天仍未确认联系" }),
    row({ key: "register", role: "专家岗", label: "注册引导", candidates: registrationDue, completed: (lead) => Boolean(lead.registeredOn), age: (lead) => Math.max(1, days(lead.expertContactedOn, today) - 2), href: "/expert-customers", rule: "联系超过2天仍未注册" }),
    row({ key: "order", role: "专家岗", label: "开单入金", candidates: orderDue, completed: (lead) => lead.hasActiveOrder, age: (lead) => Math.max(1, days(lead.registeredOn, today) - 2), href: "/expert-customers", rule: "注册超过2天仍未开单" }),
    row({ key: "finance", role: "资金", label: "资金记录核对", candidates: financeDue, completed: () => false, age: () => 1, href: "/expert-customers", rule: "出金超入金或存在资金纠错" }),
  ];
  return { cards, bottlenecks };
}
