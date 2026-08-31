import { canReadReportGroup, type PermissionUser } from "./permissions";

export type ReportGroup = { id: string; name?: string; active?: boolean; departmentId?: string; countryCode?: string | null; department?: { name?: string; countryCode?: string | null; companyId?: string | null } };

export function resolveReadableReportGroups<T extends ReportGroup>(user: PermissionUser, groups: T[]): T[] {
  return groups.filter((group) => canReadReportGroup(user, group));
}

export function resolveSelectedReportGroupIds(groups: ReportGroup[], requestedGroupId?: string): string[] {
  if (!requestedGroupId) return groups.map((group) => group.id);
  return groups.some((group) => group.id === requestedGroupId) ? [requestedGroupId] : [];
}
