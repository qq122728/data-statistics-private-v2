import { numberEvents } from "../../packages/customer-sheet/number-statistics";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import type { SheetData } from "../../packages/customer-sheet/schema";

type QualityCount = { eligible: number; ordered: number };
export type IntakeQualityRow = {
  groupId: string;
  sevenDay: { current: QualityCount; previous: QualityCount };
  thirtyDay: { current: QualityCount; previous: QualityCount };
};

function addDays(day: string, count: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** Compare equal-length intake periods, only after both cohorts have had the full observation window. */
export function intakeQuality(
  rows: Array<{ groupId: string; data: string }>,
  allowedGroupIds: ReadonlySet<string>,
  from: string,
  to: string,
  asOf: string,
) {
  const periodDays = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  const previousFrom = addDays(from, -periodDays);
  const previousTo = addDays(from, -1);
  const buckets = new Map<string, IntakeQualityRow>();

  for (const row of rows) {
    const data = JSON.parse(row.data) as SheetData;
    const groupId = sheetStatisticsGroup(row.groupId, data);
    if (!allowedGroupIds.has(groupId)) continue;
    const events = numberEvents(data);
    const intakeOn = events.find((event) => event.field === "effectiveCount")?.date;
    if (!intakeOn) continue;
    const period = intakeOn >= from && intakeOn <= to ? "current" : intakeOn >= previousFrom && intakeOn <= previousTo ? "previous" : null;
    if (!period) continue;
    const comparableDate = period === "current" ? intakeOn : addDays(intakeOn, periodDays);
    const orderOn = events.find((event) => event.field === "orderCount")?.date;
    const bucket = buckets.get(groupId) ?? {
      groupId,
      sevenDay: { current: { eligible: 0, ordered: 0 }, previous: { eligible: 0, ordered: 0 } },
      thirtyDay: { current: { eligible: 0, ordered: 0 }, previous: { eligible: 0, ordered: 0 } },
    };
    for (const [days, key] of [[7, "sevenDay"], [30, "thirtyDay"]] as const) {
      if (addDays(comparableDate, days) > asOf) continue;
      const count = bucket[key][period];
      count.eligible++;
      if (orderOn && orderOn >= intakeOn && orderOn <= addDays(intakeOn, days)) count.ordered++;
    }
    buckets.set(groupId, bucket);
  }

  return { previousFrom, previousTo, rows: [...buckets.values()] };
}
