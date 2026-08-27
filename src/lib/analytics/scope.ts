import { normalizeChannelName } from "../channel-names";
import type { PermissionUser } from "../permissions";
import { hasManagementAccess } from "../role-access";
import type { AnalysisFilters, AnalysisScope, ManagementRole } from "./types";
import { invalidMemberPeriodWarning, resolveMemberPeriods } from "./member-periods";
import { API_LIMITS } from "../request-limits";

export class AnalysisAccessError extends Error {
  constructor() {
    super("管理分析仅限管理员、资源部管理员和组长");
    this.name = "AnalysisAccessError";
  }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function resolveAnalysisScope(
  user: PermissionUser,
  filters: Partial<AnalysisFilters>,
  today: string,
  readableGroupIds: string[],
): AnalysisScope {
  if (!hasManagementAccess(user))
    throw new AnalysisAccessError();

  const groupIds = user.role === "LEAD"
    ? (user.groupId ? [user.groupId] : [])
    : filters.groupId && readableGroupIds.includes(filters.groupId)
      ? [filters.groupId]
      : readableGroupIds;
  const memberPeriods = filters.period ? resolveMemberPeriods(filters, today) : null;

  return {
    actorId: user.id,
    role: user.role as ManagementRole,
    groupIds,
    channelIds: user.role === "RESOURCE_MANAGER" ? (user.resourceChannelAccess ?? []).map((access) => access.channelId) : undefined,
    requestedForbiddenGroup: Boolean(filters.groupId && !groupIds.includes(filters.groupId)),
    batchId: filters.batchId,
    departmentId: filters.departmentId,
    countryCode: filters.countryCode,
    month: filters.month,
    groupId: user.role === "LEAD" ? user.groupId ?? undefined : filters.groupId,
    memberId: filters.memberId,
    normalizedName: filters.normalizedName ? normalizeChannelName(filters.normalizedName) : undefined,
    period: memberPeriods?.period ?? filters.period,
    sourceDateFrom: filters.sourceDateFrom ?? addDays(today, -29),
    sourceDateTo: filters.sourceDateTo ?? today,
    includeInactive: filters.includeInactive === true,
    showInsufficient: filters.showInsufficient === true,
    filterWarning: filters.filterWarning ?? memberPeriods?.warning ?? undefined,
  };
}

export function parseAnalysisFilters(searchParams: URLSearchParams): Partial<AnalysisFilters> {
  const value = (key: string) => {
    const input = searchParams.get(key);
    return input && input.length <= API_LIMITS.searchCharacters ? input : undefined;
  };
  const sourceDateFrom = value("sourceDateFrom");
  const sourceDateTo = value("sourceDateTo");
  const rawMonth = value("month");
  const validMonth = rawMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth) ? rawMonth : undefined;
  const monthEnd = validMonth
    ? new Date(Date.UTC(Number(validMonth.slice(0, 4)), Number(validMonth.slice(5, 7)), 0)).toISOString().slice(0, 10)
    : undefined;
  const validDate = (input: string | undefined) => {
    if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return !input;
    const parsed = new Date(`${input}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === input;
  };
  const invalidRange = !validMonth && (
    !validDate(sourceDateFrom)
    || !validDate(sourceDateTo)
    || Boolean(sourceDateFrom && sourceDateTo && sourceDateFrom > sourceDateTo)
  );
  const rawPeriod = value("period");
  const validPeriod = rawPeriod === "mature7" || rawPeriod === "mature30" || rawPeriod === "custom";
  const invalidPeriod = Boolean(rawPeriod && !validPeriod);
  return {
    batchId: value("batchId"),
    departmentId: value("departmentId"),
    countryCode: value("countryCode"),
    month: validMonth,
    groupId: value("groupId"),
    memberId: value("memberId"),
    normalizedName: value("normalizedName"),
    period: validPeriod ? rawPeriod : undefined,
    sourceDateFrom: invalidRange ? undefined : validMonth ? `${validMonth}-01` : sourceDateFrom,
    sourceDateTo: invalidRange ? undefined : validMonth ? monthEnd : sourceDateTo,
    includeInactive: searchParams.get("includeInactive") === "1",
    showInsufficient: searchParams.get("showInsufficient") === "1",
    filterWarning: invalidRange
      ? "日期筛选无效，已恢复默认日期范围。"
      : invalidPeriod ? invalidMemberPeriodWarning : undefined,
  };
}

export function buildAnalysisHref(
  pathname: string,
  filters: Partial<AnalysisFilters>,
  overrides: Partial<AnalysisFilters> = {},
): string {
  const values = { ...filters, ...overrides };
  const params = new URLSearchParams();
  for (const key of ["period", "departmentId", "countryCode", "month", "batchId", "groupId", "memberId", "normalizedName", "sourceDateFrom", "sourceDateTo"] as const) {
    const value = values[key];
    if (value) params.set(key, value);
  }
  if (values.includeInactive) params.set("includeInactive", "1");
  if (values.showInsufficient) params.set("showInsufficient", "1");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
