export type CustomerFollowUpStage =
  | "INVALID"
  | "LEFT_GROUP"
  | "ORDERED"
  | "REGISTERED"
  | "WAITING_EXPERT_ASSIGNMENT"
  | "EXPERT_INTRODUCED"
  | "IN_GROUP"
  | "REPLIED"
  | "NEW";

export const customerFollowUpStageLabels: Record<CustomerFollowUpStage, string> = {
  INVALID: "无效粉",
  LEFT_GROUP: "已退群",
  ORDERED: "已开单",
  REGISTERED: "已注册 · 待开单",
  WAITING_EXPERT_ASSIGNMENT: "待分配专家",
  EXPERT_INTRODUCED: "已介绍 · 待注册",
  IN_GROUP: "在群 · 待介绍",
  REPLIED: "已回复 · 待入群",
  NEW: "待回复",
};

export type CustomerStageInput = {
  invalid: boolean;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  replyStatus: "NOT_REPLIED" | "REPLIED" | "FOLLOW_UP";
  expertIntroducedOn: string | null;
  registeredOn: string | null;
  expertOwnerId: string | null;
  order: null | { voidedAt: Date | string | null };
};

export function deriveCustomerFollowUpStage(input: CustomerStageInput): CustomerFollowUpStage {
  // 无效库中的客户不再参与任何待办或转化阶段。
  if (input.invalid) return "INVALID";
  if (input.groupStatus === "LEFT") return "LEFT_GROUP";
  if (input.order && !input.order.voidedAt) return "ORDERED";
  if (input.registeredOn) return "REGISTERED";
  if (input.expertIntroducedOn && !input.expertOwnerId) return "WAITING_EXPERT_ASSIGNMENT";
  if (input.expertIntroducedOn) return "EXPERT_INTRODUCED";
  if (input.groupStatus === "JOINED") return "IN_GROUP";
  if (input.replyStatus === "REPLIED") return "REPLIED";
  return "NEW";
}

export function isClosedCustomerStage(stage: CustomerFollowUpStage): boolean {
  return stage === "INVALID" || stage === "LEFT_GROUP";
}

export function suggestedCustomerNextPlan(stage: CustomerFollowUpStage): string {
  switch (stage) {
    case "INVALID":
      return "已关闭；如误标无效粉，可在客户记录中恢复";
    case "LEFT_GROUP":
      return "已关闭；核对退群原因，必要时重新联系";
    case "ORDERED":
      return "跟进续充；发生出金时及时登记资金流水";
    case "REGISTERED":
      return "跟进首充，完成后登记开单日期和首充金额";
    case "WAITING_EXPERT_ASSIGNMENT":
      return "组长分配专家负责人";
    case "EXPERT_INTRODUCED":
      return "专家确认已对接，并跟进客户完成注册";
    case "IN_GROUP":
      return "炒群跟进群内情况，合适时推专家";
    case "REPLIED":
      return "继续沟通并引导客户入群";
    case "NEW":
      return "前台接粉联系客户；未回复时记录回访";
  }
}

function utcDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function customerStagnationDays(lastActionOn: string, today: string): number | null {
  const start = utcDay(lastActionOn);
  const end = utcDay(today);
  if (start === null || end === null) return null;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function isFollowUpPlanOverdue(nextFollowUpOn: string | null, today: string): boolean {
  if (!nextFollowUpOn) return false;
  const target = utcDay(nextFollowUpOn);
  const current = utcDay(today);
  return target !== null && current !== null && target < current;
}
