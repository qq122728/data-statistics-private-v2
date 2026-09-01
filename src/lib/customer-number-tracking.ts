/**
 * 客户进度与公司统计已经确认永久分账。保留这个兼容字段只是为了让旧前端
 * 安全退出“号码自动统计”模式；任何真实业务日期都不会到达这个日期。
 */
export const CUSTOMER_NUMBER_TRACKING_FROM = "9999-12-31";

export function usesCustomerNumberTracking(businessDate: string) {
  return businessDate >= CUSTOMER_NUMBER_TRACKING_FROM;
}

export const NUMBER_TRACKED_DAILY_FIELDS = [
  "joinCount",
  "operatorReceivedCount",
  "normalLeaveCount",
  "abnormalLeaveCount",
  "currentInGroupCount",
  "expertIntroCount",
  "expertReceivedCount",
  "expertContactedCount",
  "registrationCount",
  "orderCount",
] as const;

/**
 * 切换日前已经保存的接粉日报可能还带着人工填写的后段指标。
 * 所有汇总入口统一忽略这些旧值，避免和号码事件行重复计算。
 */
export function revisionForNumberTracking<T extends Record<string, unknown>>(
  revision: T,
  scope: { businessDate: string; position: string; groupType: string },
): T {
  if (scope.groupType !== "HACKER" || scope.position !== "RECEPTION" || !usesCustomerNumberTracking(scope.businessDate)) {
    return revision;
  }
  const result = { ...revision };
  const mutableResult = result as Record<string, unknown>;
  for (const field of NUMBER_TRACKED_DAILY_FIELDS) mutableResult[field] = 0;
  return result;
}
