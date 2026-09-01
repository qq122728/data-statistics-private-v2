import { leadDateRangeForPreset, type LeadDateRange } from "../lead-date-range";
import type { InheritableBusinessTime } from "../business-time";
import { statisticsDate } from "../statistics-date";

type GroupWithBusinessTime = InheritableBusinessTime & { id: string };

/** 所有小组共用北京时间 14:00 换日后的同一个统计日期。 */
export function buildGroupBusinessPeriods(groups: GroupWithBusinessTime[], now: Date, range: LeadDateRange) {
  const today = statisticsDate(now);
  const sharedRange = leadDateRangeForPreset(range.preset, today, range.from, range.to);
  return Object.fromEntries(groups.map((group) => {
    return [group.id, { today, from: sharedRange.from, to: sharedRange.to }];
  }));
}
