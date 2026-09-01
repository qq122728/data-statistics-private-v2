import { localClockMinutes } from "./business-time-config";

export type GroupDailySchedule = {
  id: string;
  name: string;
  timezone: string;
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
