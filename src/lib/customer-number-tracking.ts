/**
 * 从这个北京时间统计日开始，黑客组的进群及后续指标以客户号码事件为准。
 * 旧日期仍保留原来的手工日报，不做反向重算。
 */
export const CUSTOMER_NUMBER_TRACKING_FROM = "2026-09-02";

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
  "cryptoInitialDepositCents",
  "bankInitialDepositCents",
  "cryptoRechargeCents",
  "bankRechargeCents",
  "withdrawalCents",
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
