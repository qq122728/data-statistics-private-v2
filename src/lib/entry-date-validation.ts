import { isCalendarDate } from "./dates";

/** 日期字段统一按 YYYY-MM-DD 比较，前提是调用方已取到所属小组的当地“今天”。 */
export function entryDateError(value: string, today: string, label: string): string | null {
  if (!isCalendarDate(value)) return `${label}必须是实际存在的日期`;
  if (value > today) return `${label}不能晚于所在小组当地今天`;
  return null;
}
