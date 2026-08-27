import { redirect } from "next/navigation";
import { AnalysisFilters } from "../../../components/analytics/AnalysisFilters";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { RoleRankingsTable } from "../../../components/analytics/RoleRankingsTable";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { loadRoleRankings } from "../../../lib/analytics/role-rankings";
import { parseAnalysisFilters, resolveAnalysisScope } from "../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { getSystemSettings } from "../../../lib/settings";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

function countryName(code: string) {
  try { return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code; }
  catch { return code; }
}

export default async function RoleRankingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/role-rankings"); throw error; }
  if (user.role !== "ADMIN" && user.role !== "RESOURCE_MANAGER" && user.role !== "COMPANY_MANAGER" && user.role !== "FINANCE" && user.role !== "LEAD") redirect("/dashboard");

  const [raw, settings, allGroups, departments] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({
      select: { id: true, name: true, active: true, departmentId: true, countryCode: true, department: { select: { name: true, countryCode: true } } },
      orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => first(value) === undefined ? [] : [[key, first(value)!]]));
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const parsed = parseAnalysisFilters(new URLSearchParams(rawValues));
  const readableGroups = resolveReadableReportGroups(user, allGroups);
  const departmentGroups = parsed.departmentId ? readableGroups.filter((group) => group.departmentId === parsed.departmentId) : readableGroups;
  const filteredGroups = parsed.countryCode ? departmentGroups.filter((group) => (group.countryCode || group.department.countryCode) === parsed.countryCode) : departmentGroups;
  const scope = resolveAnalysisScope(user, { ...parsed, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }, today, filteredGroups.map((group) => group.id));
  const [result, channels] = await Promise.all([
    loadRoleRankings({ groupIds: scope.groupIds, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to, today, normalizedName: scope.normalizedName, channelIds: scope.channelIds }),
    db.channel.findMany({ where: { groupId: { in: filteredGroups.map((group) => group.id) }, ...(scope.channelIds ? { id: { in: scope.channelIds } } : {}) }, select: { normalizedName: true, name: true, active: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  const globalViewer = user.role === "ADMIN" || user.role === "RESOURCE_MANAGER" || user.role === "COMPANY_MANAGER" || user.role === "FINANCE";
  const countryOptions = [...new Set(departmentGroups.map((group) => group.countryCode || group.department.countryCode).filter((code): code is string => Boolean(code)))].sort().map((code) => ({ code, name: countryName(code) }));
  const groupOptions = filteredGroups.map((group) => ({ ...group, name: `${group.department.name} / ${countryName(group.countryCode || group.department.countryCode || "ZZ")} / ${group.name}` }));
  const channelOptions = [...new Map(channels.map((channel) => [channel.normalizedName, channel])).values()];
  const preserved = { departmentId: scope.departmentId, countryCode: scope.countryCode, groupId: scope.groupId, normalizedName: scope.normalizedName };

  return <main className="page-shell workflow-wide-page data-center-page space-y-2">
    <div className="page-heading"><div><h1 className="page-title">完整榜单</h1><p className="page-description">按小组统一排行，使用项目现有的有效数据、流程转化和计入业绩口径；点击小组可查看每日明细。</p></div></div>
    {user.role === "LEAD" ? <LeadWorkspaceTabs kind="team" /> : null}
    <LeadDateRangeFilter pathname="/role-rankings" range={dateRange} today={today} preserve={preserved} ariaLabel="完整榜单时间范围" />
    <AnalysisFilters action="/role-rankings" visible={{ department: user.role === "ADMIN" || user.role === "RESOURCE_MANAGER" || user.role === "FINANCE", country: globalViewer, group: globalViewer, channel: true }} primary={globalViewer ? ["department", "country", "group"] : ["channel"]} options={{ departments, countries: countryOptions, groups: groupOptions, channels: channelOptions }} values={scope} preserve={{ range: dateRange.preset, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }} compact />
    <AnalysisFilterNotice message={scope.filterWarning} />
    {scope.requestedForbiddenGroup ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">请求的小组不在当前账号的可查看范围内。</p> : null}
    <RoleRankingsTable result={result} initialView="group" showTabs={false} groupDetailQuery={{ departmentId: scope.departmentId, countryCode: scope.countryCode, normalizedName: scope.normalizedName, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }} />
  </main>;
}
