/**
 * 接粉回复队列的归档规则：已回访 5 次仍未回复的客户先收进归档。
 * 归档只是收纳，不改变客户的真实流程；一旦客户回复，仍可正常确认回复、入群。
 */
export function isReceptionReplyArchived(input: {
  repliedOn?: string | null;
  followUpCount?: number;
  receptionArchivedAt?: Date | string | null;
}): boolean {
  return Boolean(input.receptionArchivedAt) || (!input.repliedOn && (input.followUpCount ?? 0) >= 5);
}

export function receptionReplyArchiveType(input: {
  repliedOn?: string | null;
  followUpCount?: number;
  receptionArchivedAt?: Date | string | null;
}): "UNANSWERED" | "NOT_JOINED" | null {
  if (input.receptionArchivedAt && input.repliedOn) return "NOT_JOINED";
  if (!input.repliedOn && (input.followUpCount ?? 0) >= 5) return "UNANSWERED";
  return null;
}
