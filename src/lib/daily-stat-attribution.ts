/**
 * 个人业绩的永久归属人。
 *
 * ownerId 表示“这一行是谁填的”；sourceReceptionId 表示“这条客户线最初归谁”。
 * 炒群和专家代为填写下游数字时，个人汇总必须回到来源接粉人，不能算给填写人。
 * 旧数据没有 sourceReceptionId，才退回 ownerId，保证历史报表不会变空。
 */
export function dailyStatAttributionOwnerId(entry: {
  ownerId: string;
  sourceReceptionId: string | null;
}): string {
  return entry.sourceReceptionId ?? entry.ownerId;
}

export function dailyStatAttributionOwner<T extends { id: string }>(entry: {
  owner: T;
  sourceReception: T | null;
}): T {
  return entry.sourceReception ?? entry.owner;
}
