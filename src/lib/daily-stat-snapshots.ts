type CurrentInGroupSnapshotEntry = {
  groupId: string;
  channelId: string;
  ownerId: string;
  sourceReceptionId: string | null;
  businessDate: string;
  position: string;
  currentRevision?: { currentInGroupCount: number } | null;
  approvedRevision: { currentInGroupCount: number } | null;
};

/**
 * “当前在群”是业务线快照，不是每天可以累加的流量。
 * 旧数据按“小组 + 渠道 + 炒群 + 来源接粉”识别业务线；新版统一组员日报
 * 则按“小组 + 渠道 + 归属组员”识别。每条线只取截止日最近一版，再相加。
 */
export function sumLatestCurrentInGroup(entries: CurrentInGroupSnapshotEntry[]): number {
  const latestByLine = new Map<string, { date: string; count: number }>();
  for (const entry of entries) {
    const revision = entry.currentRevision ?? entry.approvedRevision;
    if (!revision || (entry.position !== "GROUP_OPERATOR" && entry.position !== "RECEPTION")) continue;
    const lineKey = entry.position === "RECEPTION"
      ? JSON.stringify(["UNIFIED_MEMBER", entry.groupId, entry.channelId, entry.ownerId])
      : JSON.stringify(["LEGACY_OPERATOR", entry.groupId, entry.channelId, entry.ownerId, entry.sourceReceptionId]);
    const current = latestByLine.get(lineKey);
    if (!current || entry.businessDate > current.date) {
      latestByLine.set(lineKey, {
        date: entry.businessDate,
        count: revision.currentInGroupCount,
      });
    } else if (entry.businessDate === current.date) {
      current.count += revision.currentInGroupCount;
    }
  }
  return [...latestByLine.values()].reduce((sum, item) => sum + item.count, 0);
}
