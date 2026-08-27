import type { HistoryGroup } from "./history-groups";

export function compareHistoryGroups(left: HistoryGroup, right: HistoryGroup): number {
  return right.occurredOn.localeCompare(left.occurredOn)
    || right.sourceDate.localeCompare(left.sourceDate)
    || left.batch.channel.name.localeCompare(right.batch.channel.name, "zh-CN")
    || left.batch.id.localeCompare(right.batch.id)
    || left.enteredBy.id.localeCompare(right.enteredBy.id);
}
