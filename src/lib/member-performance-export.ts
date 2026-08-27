import { db } from "./db";
import { loadRoleRankings } from "./analytics/role-rankings";
import { loadSourcePerformanceSummary } from "./source-performance-summary";

function eachDate(from: string, to: string) {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * 把同一统计范围的成员、小组、渠道数据一次性准备好，供月度业绩表和每日数据表共用。
 * 当只传一天时，流程和资金都按当天截止，避免把之后发生的动作带进历史日报。
 */
export async function loadMemberPerformanceExport(input: { from: string; to: string; groupIds: string[] }) {
  const dates = eachDate(input.from, input.to);
  const [summary, daily, duplicateEvents, sourceSummary] = await Promise.all([
    loadRoleRankings({ groupIds: input.groupIds, sourceDateFrom: input.from, sourceDateTo: input.to, today: input.to }),
    Promise.all(dates.map(async (date) => ({
      date,
      result: await loadRoleRankings({ groupIds: input.groupIds, sourceDateFrom: date, sourceDateTo: date, today: date }),
    }))),
    db.metricEvent.findMany({
      where: { kind: "DUPLICATE_FANS", voidedAt: null, batch: { groupId: { in: input.groupIds }, sourceDate: { gte: input.from, lte: input.to } } },
      select: { quantity: true, batch: { select: { groupId: true, sourceDate: true } } },
    }),
    loadSourcePerformanceSummary({ groupIds: input.groupIds, sourceDateFrom: input.from, sourceDateTo: input.to, today: input.to }),
  ]);

  const duplicateByDayGroup = new Map<string, number>();
  for (const event of duplicateEvents) {
    const eventKey = `${event.batch.sourceDate}:${event.batch.groupId}`;
    duplicateByDayGroup.set(eventKey, (duplicateByDayGroup.get(eventKey) ?? 0) + (event.quantity ?? 0));
  }
  return { summary, daily, duplicateByDayGroup, sourceSummary };
}
