import { localDateYYYYMMDD } from "./dates";

export const BUSINESS_TIMEZONE_OPTIONS = [
  { countryCode: "CN", timezone: "Asia/Shanghai", label: "中国时间（北京）", countryLabel: "中国" },
  { countryCode: "HK", timezone: "Asia/Hong_Kong", label: "中国香港时间", countryLabel: "中国香港" },
  { countryCode: "SG", timezone: "Asia/Singapore", label: "新加坡时间", countryLabel: "新加坡" },
  { countryCode: "MY", timezone: "Asia/Kuala_Lumpur", label: "马来西亚时间（吉隆坡）", countryLabel: "马来西亚" },
  { countryCode: "PH", timezone: "Asia/Manila", label: "菲律宾时间（马尼拉）", countryLabel: "菲律宾" },
  { countryCode: "TH", timezone: "Asia/Bangkok", label: "泰国时间（曼谷）", countryLabel: "泰国" },
  { countryCode: "VN", timezone: "Asia/Ho_Chi_Minh", label: "越南时间（胡志明市）", countryLabel: "越南" },
  { countryCode: "ID", timezone: "Asia/Jakarta", label: "印度尼西亚西部时间（雅加达）", countryLabel: "印度尼西亚" },
  { countryCode: "JP", timezone: "Asia/Tokyo", label: "日本时间（东京）", countryLabel: "日本" },
  { countryCode: "KR", timezone: "Asia/Seoul", label: "韩国时间（首尔）", countryLabel: "韩国" },
  { countryCode: "IN", timezone: "Asia/Kolkata", label: "印度时间（加尔各答）", countryLabel: "印度" },
  { countryCode: "AE", timezone: "Asia/Dubai", label: "阿联酋时间（迪拜）", countryLabel: "阿联酋" },
  { countryCode: "DE", timezone: "Europe/Berlin", label: "德国时间（柏林）", countryLabel: "德国" },
  { countryCode: "GB", timezone: "Europe/London", label: "英国时间（伦敦）", countryLabel: "英国" },
  { countryCode: "US", timezone: "America/New_York", label: "美国东部时间（纽约）", countryLabel: "美国" },
  { countryCode: "US", timezone: "America/Chicago", label: "美国中部时间（芝加哥）", countryLabel: "美国" },
  { countryCode: "US", timezone: "America/Denver", label: "美国山地时间（丹佛）", countryLabel: "美国" },
  { countryCode: "US", timezone: "America/Los_Angeles", label: "美国西部时间（洛杉矶）", countryLabel: "美国" },
  { countryCode: "CA", timezone: "America/Toronto", label: "加拿大东部时间（多伦多）", countryLabel: "加拿大" },
  { countryCode: "CA", timezone: "America/Vancouver", label: "加拿大西部时间（温哥华）", countryLabel: "加拿大" },
  { countryCode: "AU", timezone: "Australia/Sydney", label: "澳大利亚东部时间（悉尼）", countryLabel: "澳大利亚" },
  { countryCode: "NZ", timezone: "Pacific/Auckland", label: "新西兰时间（奥克兰）", countryLabel: "新西兰" },
] as const;

export type BusinessTimeConfig = {
  countryCode: string;
  timezone: string;
  workStartMinutes: number;
  workEndMinutes: number;
};

export type InheritableBusinessTime = {
  countryCode: string | null;
  timezone: string | null;
  workStartMinutes: number | null;
  workEndMinutes: number | null;
  department: BusinessTimeConfig;
};

export const DEFAULT_WORK_START_MINUTES = 10 * 60;
export const DEFAULT_WORK_END_MINUTES = 22 * 60;

export function isSupportedBusinessTimezone(value: string): boolean {
  return BUSINESS_TIMEZONE_OPTIONS.some((option) => option.timezone === value);
}

export function businessTimezoneOption(timezone: string) {
  return BUSINESS_TIMEZONE_OPTIONS.find((option) => option.timezone === timezone)
    ?? { countryCode: "OTHER", timezone, label: timezone, countryLabel: "其他" };
}

export function resolveGroupBusinessTime(group: InheritableBusinessTime): BusinessTimeConfig {
  return {
    countryCode: group.countryCode ?? group.department.countryCode,
    timezone: group.timezone ?? group.department.timezone,
    workStartMinutes: group.workStartMinutes ?? group.department.workStartMinutes,
    workEndMinutes: group.workEndMinutes ?? group.department.workEndMinutes,
  };
}

export function minutesToTime(value: number): string {
  const hours = Math.floor(value / 60).toString().padStart(2, "0");
  const minutes = (value % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function localClockMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function businessWorkStatus(config: BusinessTimeConfig, now = new Date()) {
  const minutes = localClockMinutes(now, config.timezone);
  const status = minutes < config.workStartMinutes
    ? "BEFORE_WORK" as const
    : minutes < config.workEndMinutes
      ? "WORKING" as const
      : "AFTER_WORK" as const;
  return {
    status,
    label: status === "BEFORE_WORK" ? "未上班" : status === "WORKING" ? "工作中" : "已下班",
    businessDate: localDateYYYYMMDD(now, config.timezone),
    localTime: new Intl.DateTimeFormat("zh-CN", {
      timeZone: config.timezone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now),
  };
}
