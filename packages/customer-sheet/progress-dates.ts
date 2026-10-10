import type { SheetData } from "./schema";
import { investmentSummary } from "./investment";

// Optional stages may be omitted; dates that are present must follow this order.
const progression = ["intakeOn", "repliedOn", "joinedOn", "expertOn", "traceStartedOn", "invitedOn", "registeredOn", "firstDepositOn"];
const labels: Record<string, string> = { intakeOn:"接粉日期", repliedOn:"回复日期", joinedOn:"进群日期", expertOn:"加专家日期", traceStartedOn:"追踪开始日期", invitedOn:"邀请注册日期", registeredOn:"开户日期", firstDepositOn:"首充日期", orderedOn:"开单日期", normalLeftOn:"正常退群日期", abnormalLeftOn:"异常退群日期" };
export const actualDateFields = Object.keys(labels);
const day = (value: unknown) => String(value || "").slice(0, 10);

/** Check changed relationships, without rewriting or blocking unrelated legacy facts. */
export function progressDateError(next: SheetData, previous: SheetData, today: string): string | undefined {
 const changed = (...keys: string[]) => keys.some(key => next[key] !== previous[key]);
 const dates: SheetData = {...next, firstDepositOn: next.firstDepositOn || next.orderedOn};
 const oldDates: SheetData = {...previous, firstDepositOn: previous.firstDepositOn || previous.orderedOn};
 for (const key of actualDateFields) {
  if (!dates[key] || !(changed(key,"intakeOn") || key === "firstDepositOn" && changed("orderedOn"))) continue;
  if (day(dates[key]) > today) return `${labels[key]} ${day(dates[key])} 不能晚于系统统计日 ${today}（北京时间14:00换日）`;
  if (dates.intakeOn && day(dates[key]) < day(dates.intakeOn)) return `${labels[key]}不能早于接粉日期 ${day(dates.intakeOn)}`;
 }
 for (let i = 0; i < progression.length; i++) for (let j = i + 1; j < progression.length; j++) {
  const before = progression[i], after = progression[j];
  if (dates[before] === oldDates[before] && dates[after] === oldDates[after]) continue;
  if (dates[before] && dates[after] && day(dates[before]) > day(dates[after])) return `${labels[before]} ${day(dates[before])} 不能晚于${labels[after]} ${day(dates[after])}；允许同一天，请核对实际日期`;
  if (["intakeOn","repliedOn","joinedOn","expertOn"].includes(before) && oldDates[before] && !dates[before] && dates[after]) return `已有${labels[after]}，不能直接清空${labels[before]}；请先核对后续记录`;
 }
 for (const [flag, key] of [["normalLeft","normalLeftOn"],["abnormalLeft","abnormalLeftOn"]]) {
  if (!changed(flag,key,"joinedOn")) continue;
  if (next[flag] === true && (!next.joinedOn || next[key] && day(next[key]) < day(next.joinedOn))) return `${labels[key]}必须有进群日期，且不能早于进群日期`;
 }
 const previousEntries = new Map(investmentSummary(previous).entries.map(e => [e.id,e]));
 for (const entry of investmentSummary(next).entries) {
  const old = previousEntries.get(entry.id);
  if (old?.date === entry.date && !changed("intakeOn","firstDepositOn","orderedOn")) continue;
  const label = entry.kind === "withdrawal" ? "出金日期" : "续充日期";
  if (entry.date > today || dates.intakeOn && entry.date < day(dates.intakeOn)) return `${label}不能早于接粉日期，也不能晚于系统统计日 ${today}`;
  if (dates.firstDepositOn && entry.date < day(dates.firstDepositOn)) return `${label} ${entry.date} 不能早于首充日期 ${day(dates.firstDepositOn)}；允许同一天`;
  if (oldDates.firstDepositOn && !dates.firstDepositOn) return "已有续充或出金记录，不能直接清空首充日期";
 }
}
