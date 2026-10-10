import { numberEvents } from "../../packages/customer-sheet/number-statistics";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import type { SheetData } from "../../packages/customer-sheet/schema";

export type OrderCohortRow = { groupId: string; channelId: string; current: number; previous: number };

/** Split orders in the selected reporting period by the customer's original intake date. */
export function orderCohorts(
  rows: Array<{ groupId: string; data: string }>,
  allowedGroupIds: ReadonlySet<string>,
  from: string,
  to: string,
): OrderCohortRow[] {
  const buckets = new Map<string, OrderCohortRow>();
  for (const row of rows) {
    const data = JSON.parse(row.data) as SheetData;
    const groupId = sheetStatisticsGroup(row.groupId, data);
    if (!allowedGroupIds.has(groupId)) continue;
    const orderOn = numberEvents(data).find((event) => event.field === "orderCount")?.date;
    if (!orderOn || orderOn < from || orderOn > to) continue;
    const intakeOn = String(data.intakeOn).slice(0, 10);
    const channelId = String(data.channelId);
    const key = JSON.stringify([groupId, channelId]);
    const bucket = buckets.get(key) ?? { groupId, channelId, current: 0, previous: 0 };
    if (intakeOn >= from && intakeOn <= to) bucket.current++;
    else if (intakeOn < from) bucket.previous++;
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}
