export type CustomerStage =
  | "INVALID"
  | "ORDERED"
  | "REGISTERED"
  | "EXPERT_CONTACTED"
  | "EXPERT_INTRODUCED"
  | "LEFT_GROUP"
  | "IN_GROUP"
  | "REPLIED"
  | "FOLLOW_UP"
  | "NEW";

export type CustomerStageInput = {
  invalid?: boolean;
  hasActiveOrder?: boolean;
  registeredOn?: string | null;
  expertContactedOn?: string | null;
  expertIntroducedOn?: string | null;
  groupStatus?: "NOT_JOINED" | "JOINED" | "LEFT";
  repliedOn?: string | null;
  followUpCount?: number;
};

export function resolveCustomerStage(customer: CustomerStageInput): CustomerStage {
  // “无效粉”代表不计资源有效粉/资源费，不再代表停止客户流程。
  // 保留 INVALID 枚举是为兼容历史展示，但新客户会按真实跟进进度显示。
  if (customer.hasActiveOrder) return "ORDERED";
  if (customer.registeredOn) return "REGISTERED";
  if (customer.expertContactedOn) return "EXPERT_CONTACTED";
  if (customer.expertIntroducedOn) return "EXPERT_INTRODUCED";
  if (customer.groupStatus === "LEFT") return "LEFT_GROUP";
  if (customer.groupStatus === "JOINED") return "IN_GROUP";
  if (customer.repliedOn) return "REPLIED";
  if (customer.followUpCount) return "FOLLOW_UP";
  return "NEW";
}
