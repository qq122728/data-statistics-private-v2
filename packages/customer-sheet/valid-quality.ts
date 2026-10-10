export const validQualityMessage = "只允许导入有效客户；撞粉、低金额、无 WS 号码、人工无效不再支持录入，请从导入名单移除这些记录";
export function invalidQuality(value: unknown) { return value != null && String(value).trim() !== "" && String(value).trim() !== "有效"; }
