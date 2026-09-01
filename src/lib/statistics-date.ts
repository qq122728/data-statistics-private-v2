import { addLocalDays, localDateYYYYMMDD } from "./dates";

/**
 * 全公司的数据统计只认北京时间，并在北京时间 14:00 切换到下一统计日。
 * 国家/小组时区仍可用于考勤和当地时间展示，不能用于数据归属日期。
 */
export const STATISTICS_TIMEZONE = "Asia/Shanghai";
export const STATISTICS_ROLLOVER_HOUR = 14;

export function statisticsDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STATISTICS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const chinaCalendarDate = localDateYYYYMMDD(now, STATISTICS_TIMEZONE);
  const afterRollover = value("hour") * 60 + value("minute") >= STATISTICS_ROLLOVER_HOUR * 60;
  return afterRollover ? addLocalDays(chinaCalendarDate, 1)! : chinaCalendarDate;
}

export function statisticsDateContext(now = new Date()) {
  return {
    today: statisticsDate(now),
    timezone: STATISTICS_TIMEZONE,
    rolloverHour: STATISTICS_ROLLOVER_HOUR,
    rolloverLabel: "北京时间 14:00",
  } as const;
}
