type OperatorAttributionActivity = {
  actorId: string;
  occurredOn: string;
  kind?: string;
};

type OperatorAttributionLead = {
  ownerId: string;
  groupOperatorOwnerId: string | null;
  activities: OperatorAttributionActivity[];
};

/**
 * 炒群归属的唯一三层口径：明确指派 → 截止日以前最近一次推专家动作 → 当前接粉配对。
 * 主榜单、每日明细和快照统计必须共用，避免同一客户在不同页面算给不同的人。
 */
export function resolveGroupOperatorId(
  lead: OperatorAttributionLead,
  currentOperatorByReception: ReadonlyMap<string, string>,
  throughDate: string,
) {
  if (lead.groupOperatorOwnerId) return lead.groupOperatorOwnerId;

  let latestIntroduction: OperatorAttributionActivity | undefined;
  for (const activity of lead.activities) {
    if (activity.kind && activity.kind !== "EXPERT_INTRODUCED") continue;
    if (activity.occurredOn > throughDate) continue;
    if (!latestIntroduction || activity.occurredOn > latestIntroduction.occurredOn)
      latestIntroduction = activity;
  }

  return latestIntroduction?.actorId ?? currentOperatorByReception.get(lead.ownerId);
}
