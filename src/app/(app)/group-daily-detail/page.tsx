import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { redirect } from "next/navigation";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { GroupDailyDetailsTable } from "../../../components/analytics/team/TeamPerformanceTable";
import { GroupDailyTrend } from "../../../components/analytics/team/GroupDailyTrend";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { loadTeamPerformance } from "../../../lib/analytics/team-performance";
import { parseAnalysisFilters, resolveAnalysisScope } from "../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { getSystemSettings } from "../../../lib/settings";
import { buildGroupBusinessPeriods } from "../../../lib/analytics/group-business-periods";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

function countryName(code: string) {
  try { return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code; }
  catch { return code; }
}

function requestedGroupIds(value: string | string[] | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean))];
}

export default async function GroupDailyDetailPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/group-daily-detail"); throw error; }
  if (user.role !== "ADMIN" && user.role !== "RESOURCE_MANAGER" && user.role !== "COMPANY_MANAGER" && user.role !== "FINANCE" && user.role !== "LEAD") redirect("/dashboard");

  const [raw, settings, allGroups, departments] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({
      select: { id: true, name: true, active: true, departmentId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, department: { select: { name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } } },
      orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date();
  const today = localDateYYYYMMDD(now, await resolveUserBusinessTimezone(user, settings.timezone));
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => first(value) === undefined ? [] : [[key, first(value)!]]));
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const parsed = parseAnalysisFilters(new URLSearchParams(rawValues));
  const readableGroups = resolveReadableReportGroups(user, allGroups);
  const departmentGroups = parsed.departmentId ? readableGroups.filter((group) => group.departmentId === parsed.departmentId) : readableGroups;
  const filteredGroups = parsed.countryCode ? departmentGroups.filter((group) => (group.countryCode || group.department.countryCode) === parsed.countryCode) : departmentGroups;
  const requested = requestedGroupIds(raw.groupIds ?? raw.groupId);
  const selectedGroupIds = requested.length ? filteredGroups.filter((group) => requested.includes(group.id)).map((group) => group.id) : filteredGroups.map((group) => group.id);
  const rejectedGroup = requested.some((groupId) => !filteredGroups.some((group) => group.id === groupId));
  const baseScope = resolveAnalysisScope(user, {
    ...parsed,
    groupId: undefined,
    sourceDateFrom: dateRange.from,
    sourceDateTo: dateRange.to,
  }, today, filteredGroups.map((group) => group.id));
  const scope = {
    ...baseScope,
    groupIds: selectedGroupIds,
    requestedForbiddenGroup: baseScope.requestedForbiddenGroup || rejectedGroup,
  };
  const groupPeriods = buildGroupBusinessPeriods(filteredGroups.filter((group) => selectedGroupIds.includes(group.id)), now, dateRange);
  const [result, channels] = await Promise.all([
    loadTeamPerformance(scope, today, { groupPeriods }),
    db.channel.findMany({ where: { groupId: { in: filteredGroups.map((group) => group.id) }, ...(scope.channelIds ? { id: { in: scope.channelIds } } : {}) }, select: { normalizedName: true, name: true, active: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  const visibleChannels = [...new Map(channels.map((channel) => [channel.normalizedName, channel])).values()];
  const globalViewer = user.role === "ADMIN" || user.role === "RESOURCE_MANAGER" || user.role === "COMPANY_MANAGER" || user.role === "FINANCE";
  const canFilterDepartment = user.role === "ADMIN" || user.role === "RESOURCE_MANAGER" || user.role === "FINANCE";
  const countryOptions = [...new Set(departmentGroups.map((group) => group.countryCode || group.department.countryCode).filter((code): code is string => Boolean(code)))].sort().map((code) => ({ code, name: countryName(code) }));
  const groupOptions = filteredGroups.map((group) => ({ id: group.id, name: `${group.department.name} / ${countryName(group.countryCode || group.department.countryCode || "ZZ")} / ${group.name}` }));
  const preserved = { departmentId: parsed.departmentId, countryCode: parsed.countryCode, normalizedName: parsed.normalizedName, groupIds: selectedGroupIds };

  return <main className="page-shell workflow-wide-page data-center-page space-y-2">
    <div className="page-heading"><div><h1 className="page-title">小组每日明细</h1><p className="page-description">同时选择多个小组，按实际发生日期查看每天的数据、转化和业绩；不展示客户号码或个人资料。</p></div></div>
    {user.role === "LEAD" ? <LeadWorkspaceTabs kind="team" /> : null}
    <LeadDateRangeFilter pathname="/group-daily-detail" range={dateRange} today={today} preserve={preserved} ariaLabel="小组每日明细时间范围" />
    <form action="/group-daily-detail" className="toolbar member-overview-filters">
      <input type="hidden" name="range" value={dateRange.preset} />
      <input type="hidden" name="sourceDateFrom" value={dateRange.from} />
      <input type="hidden" name="sourceDateTo" value={dateRange.to} />
      {canFilterDepartment ? <label className="field-label">下属公司<select aria-label="下属公司" name="departmentId" defaultValue={parsed.departmentId ?? ""} className="control min-w-36"><option value="">全部下属公司</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label> : null}
      {globalViewer ? <label className="field-label">国家<select aria-label="国家" name="countryCode" defaultValue={parsed.countryCode ?? ""} className="control min-w-32"><option value="">全部国家</option>{countryOptions.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label> : null}
      {user.role === "LEAD" ? <p className="member-overview-fixed-group"><span>固定小组</span><strong>{groupOptions[0]?.name ?? "当前小组"}</strong></p> : <label className="field-label">小组<span className="text-xs font-normal text-slate-500">可多选</span><select aria-label="小组" name="groupIds" multiple defaultValue={selectedGroupIds} className="control group-daily-group-picker min-w-64">{groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      <label className="field-label">渠道<select aria-label="渠道" name="normalizedName" defaultValue={parsed.normalizedName ?? ""} className="control min-w-40"><option value="">全部渠道</option>{visibleChannels.map((channel) => <option key={channel.normalizedName} value={channel.normalizedName}>{channel.name}{channel.active ? "" : "（已停用）"}</option>)}</select></label>
      <div className="ml-auto"><button className="inline-flex min-h-9 items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><MagnifyingGlass size={16} aria-hidden="true" />查询</button></div>
    </form>
    <AnalysisFilterNotice message={scope.filterWarning} />
    {scope.requestedForbiddenGroup ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">请求的小组不在当前账号或筛选范围内，已不显示该小组数据。</p> : null}
    <GroupDailyTrend rows={result.dailyRows} />
    <GroupDailyDetailsTable rows={result.dailyRows} />
  </main>;
}
