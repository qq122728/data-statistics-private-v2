import { redirect } from "next/navigation";
import { AnalysisFilters } from "../../../components/analytics/AnalysisFilters";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { TeamPerformanceTable } from "../../../components/analytics/team/TeamPerformanceTable";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { parseAnalysisFilters, resolveAnalysisScope } from "../../../lib/analytics/scope";
import { loadTeamPerformance } from "../../../lib/analytics/team-performance";
import { statisticsDate } from "../../../lib/statistics-date";
import { db } from "../../../lib/db";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { getSystemSettings } from "../../../lib/settings";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { buildGroupBusinessPeriods } from "../../../lib/analytics/group-business-periods";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const countryName = (code: string) => {
  try { return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code; }
  catch { return code; }
};

export default async function TeamPerformancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/team-performance"); throw error; }
  if (user.role !== "ADMIN" && user.role !== "RESOURCE_MANAGER" && user.role !== "COMPANY_MANAGER" && user.role !== "FINANCE" && user.role !== "LEAD") redirect("/dashboard");

  const [raw, settings, allGroups, departments] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({ select: { id: true, name: true, active: true, departmentId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, department: { select: { name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, companyId: true } } }, orderBy: [{ department: { name: "asc" } }, { name: "asc" }] }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const today = statisticsDate(now);
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => first(value) === undefined ? [] : [[key, first(value)!]]));
  const parsedFilters = parseAnalysisFilters(new URLSearchParams(rawValues));
  // 各角色的经营统计统一默认看当月，避免不同岗位打开同一指标却看到不同周期。
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const allReadableGroups = resolveReadableReportGroups(user, allGroups);
  const departmentGroups = parsedFilters.departmentId ? allReadableGroups.filter((group) => group.departmentId === parsedFilters.departmentId) : allReadableGroups;
  const readableGroups = parsedFilters.countryCode ? departmentGroups.filter((group) => (group.countryCode || group.department.countryCode) === parsedFilters.countryCode) : departmentGroups;
  const scope = resolveAnalysisScope(user, { ...parsedFilters, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }, today, readableGroups.map((group) => group.id));
  const groupPeriods = buildGroupBusinessPeriods(readableGroups.filter((group) => scope.groupIds.includes(group.id)), now, dateRange);
  const [result, members, channels] = await Promise.all([
    loadTeamPerformance(scope, today, { groupPeriods }),
    db.user.findMany({ where: { groupId: { in: scope.groupIds }, role: { in: ["LEAD", "RECEPTION"] }, ...(scope.includeInactive ? {} : { active: true }) }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    db.channel.findMany({ where: { groupId: { in: scope.groupIds }, ...(scope.channelIds ? { id: { in: scope.channelIds } } : {}) }, select: { normalizedName: true, name: true, active: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  const channelOptions = [...new Map(channels.map((channel) => [channel.normalizedName, channel])).values()];
  const globalViewer = user.role === "ADMIN" || user.role === "RESOURCE_MANAGER" || user.role === "COMPANY_MANAGER" || user.role === "FINANCE";
  const groupOptions = readableGroups.map((group) => ({ ...group, name: `${group.department.name} / ${countryName(group.countryCode || group.department.countryCode || "ZZ")} / ${group.name}` }));
  const countryOptions = [...new Set(departmentGroups.map((group) => group.countryCode || group.department.countryCode).filter((code): code is string => Boolean(code)))].sort().map((code) => ({ code, name: countryName(code) }));
  const preserved = { departmentId: scope.departmentId, countryCode: scope.countryCode, groupId: scope.groupId, normalizedName: scope.normalizedName, includeInactive: scope.includeInactive };
  const isCompanyManager = user.role === "COMPANY_MANAGER";
  const isFinance = user.role === "FINANCE";
  const pageTitle = "数据汇总";
  const pageDescription = isFinance
    ? "只读查看全部公司的汇总、各小组对比和每日变化；不展示客户号码，也不能修改业务数据。"
    : isCompanyManager
    ? "只统计本公司的小组数据：先看汇总，再点击小组查看每日变化；这里不展示客户号码。"
    : "按实际发生日期汇总小组数据和转化结果；点击小组可继续查看每日明细。";
  return <main className="page-shell workflow-wide-page data-center-page space-y-2"><div className="page-heading"><div><h1 className="page-title">{pageTitle}</h1><p className="page-description">{pageDescription}</p></div></div>{user.role === "LEAD" ? <LeadWorkspaceTabs kind="team" /> : null}<LeadDateRangeFilter pathname="/team-performance" range={dateRange} today={today} preserve={preserved} ariaLabel={`${pageTitle}时间范围`} /><AnalysisFilters action="/team-performance" visible={{ department: user.role === "ADMIN" || user.role === "RESOURCE_MANAGER" || isFinance, country: globalViewer, group: globalViewer, channel: true, includeInactive: true }} primary={globalViewer ? ["department", "country", "group"] : ["channel"]} options={{ departments, countries: countryOptions, groups: groupOptions, members, channels: channelOptions }} values={scope} preserve={{ range: dateRange.preset, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }} compact /><AnalysisFilterNotice message={scope.filterWarning} /><TeamPerformanceTable groupRows={result.groupRows} memberRows={[]} dailyRows={result.dailyRows} mode="groups" filters={scope} showNavigation={false} showComparison={false} showPeriodGroupSummary groupDailyPath="/group-daily-detail" /></main>;
}
