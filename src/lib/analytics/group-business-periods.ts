import { localDateYYYYMMDD } from "../dates";
import { leadDateRangeForPreset, type LeadDateRange } from "../lead-date-range";
import { resolveGroupBusinessTime, type InheritableBusinessTime } from "../business-time";

type GroupWithBusinessTime = InheritableBusinessTime & { id: string };

/** 同一个“今日/近7天/当月”筛选，对每个小组按各自当地今天换算。 */
export function buildGroupBusinessPeriods(groups: GroupWithBusinessTime[], now: Date, range: LeadDateRange) {
  return Object.fromEntries(groups.map((group) => {
    const today = localDateYYYYMMDD(now, resolveGroupBusinessTime(group).timezone);
    const localRange = leadDateRangeForPreset(range.preset, today, range.from, range.to);
    return [group.id, { today, from: localRange.from, to: localRange.to }];
  }));
}
