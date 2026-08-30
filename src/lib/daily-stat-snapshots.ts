type CurrentInGroupSnapshotEntry = {
  groupId: string;
  channelId: string;
  ownerId: string;
  sourceReceptionId: string | null;
  businessDate: string;
  position: string;
  approvedRevision: { currentInGroupCount: number } | null;
};

/**
 * “当前在群”是业务线快照，不是每天可以累加的流量。
 * 同一条业务线由“小组 + 渠道 + 炒群 + 来源接粉”唯一确定；每条线只取截止日最近一版，
 * 再把不同业务线的快照相加。
 */
export function sumLatestCurrentInGroup(entries: CurrentInGroupSnapshotEntry[]): number {
  const latestByLine = new Map<string, { date: string; count: number }>();
  for (const entry of entries) {
    if (entry.position !== "GROUP_OPERATOR" || !entry.approvedRevision) continue;
    const lineKey = JSON.stringify([
      entry.groupId,
      entry.channelId,
      entry.ownerId,
      entry.sourceReceptionId,
    ]);
    const current = latestByLine.get(lineKey);
    if (!current || entry.businessDate > current.date) {
      latestByLine.set(lineKey, {
        date: entry.businessDate,
        count: entry.approvedRevision.currentInGroupCount,
      });
    } else if (entry.businessDate === current.date) {
      current.count += entry.approvedRevision.currentInGroupCount;
    }
  }
  return [...latestByLine.values()].reduce((sum, item) => sum + item.count, 0);
}
