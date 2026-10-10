import type { SheetData } from "./schema";

// Work handover changes the current owner, not the intake cohort's reporting owner.
export function sheetStatisticsOwner(ownerId: string, data: SheetData): string {
  return typeof data.__statisticsOwnerId === "string" && data.__statisticsOwnerId
    ? data.__statisticsOwnerId : ownerId;
}

export function sheetStatisticsGroup(groupId: string, data: SheetData): string {
  return typeof data.__statisticsGroupId === "string" && data.__statisticsGroupId ? data.__statisticsGroupId : groupId;
}

/** JSON is always serialized with JSON.stringify; recheck the parsed group after this query. */
export function sheetStatisticsGroupWhere(groupId: string) {
  return { OR: [{ groupId }, { data: { contains: `"__statisticsGroupId":${JSON.stringify(groupId)}` } }] };
}
