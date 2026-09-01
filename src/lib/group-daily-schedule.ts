import { localClockMinutes } from "./business-time-config";
import { statisticsDate } from "./statistics-date";

export type GroupDailySchedule = {
  id: string;
  name: string;
  timezone: string;
  workStartMinutes: number;
  workEndMinutes: number;
};

export const GROUP_DAILY_DELAY_MINUTES = 60;
export const GROUP_DAILY_DUE_WINDOW_MINUTES = 30;

/** 定时器每 5 分钟运行；进入下班后 1 小时起的 30 分钟窗口即为到期。 */
export function dueGroupDailySchedules(groups: GroupDailySchedule[], now = new Date()) {
  return groups.filter((group) => {
    const triggerAt = (group.workEndMinutes + GROUP_DAILY_DELAY_MINUTES) % (24 * 60);
    const localMinutes = localClockMinutes(now, group.timezone);
    const minutesSinceTrigger = (localMinutes - triggerAt + 24 * 60) % (24 * 60);
    return minutesSinceTrigger < GROUP_DAILY_DUE_WINDOW_MINUTES;
  });
}

/**
 * 日报归属看这一班的上班时刻，而不是看晚上几点发送。
 * 例如新加坡 10:00 上班、23:00 推送，仍属于北京时间当天；
 * 德国/美国若换算到北京时间 14:00 后才上班，则归到下一统计日。
 */
export function groupDailyReportDate(group: GroupDailySchedule, now = new Date()) {
  const localMinutes = localClockMinutes(now, group.timezone);
  const minutesSinceShiftStart = (localMinutes - group.workStartMinutes + 24 * 60) % (24 * 60);
  return statisticsDate(new Date(now.getTime() - minutesSinceShiftStart * 60_000));
}
