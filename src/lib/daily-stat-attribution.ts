/** 公司认账数据永远归实际填写人；来源接粉只保留为业务线说明。 */
export function dailyStatAttributionOwnerId(entry: {
  ownerId: string;
  sourceReceptionId: string | null;
}): string {
  return entry.ownerId;
}

export function dailyStatAttributionOwner<T extends { id: string }>(entry: {
  owner: T;
  sourceReception: T | null;
}): T {
  return entry.owner;
}
