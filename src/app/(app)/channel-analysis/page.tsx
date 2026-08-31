import { redirect } from "next/navigation";
import { AnalysisFilters } from "../../../components/analytics/AnalysisFilters";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { ChannelDetailDrawer } from "../../../components/analytics/channel/ChannelDetailDrawer";
import { ChannelQualityTable } from "../../../components/analytics/channel/ChannelQualityTable";
import { loadChannelAnalysis } from "../../../lib/analytics/channel-analysis";
import { parseAnalysisFilters, resolveAnalysisScope } from "../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { getSystemSettings } from "../../../lib/settings";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function ChannelAnalysisPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/channel-analysis"); throw error; }
  if (user.role !== "ADMIN" && user.role !== "RESOURCE_MANAGER" && user.role !== "COMPANY_MANAGER" && user.role !== "FINANCE" && user.role !== "LEAD") redirect("/dashboard");
  const [raw, settings, groups, departments] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({ select: { id: true, name: true, active: true, departmentId: true, countryCode: true, department: { select: { name: true, countryCode: true, companyId: true } } }, orderBy: { name: "asc" } }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const allReadableGroups = resolveReadableReportGroups(user, groups);
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => first(value) === undefined ? [] : [[key, first(value)!]]));
  const parsedFilters = parseAnalysisFilters(new URLSearchParams(rawValues));
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const readableGroups = parsedFilters.departmentId ? allReadableGroups.filter((group) => group.departmentId === parsedFilters.departmentId) : allReadableGroups;
  const scope = resolveAnalysisScope(user, { ...parsedFilters, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }, today, readableGroups.map((group) => group.id));
  const isResourceManager = user.role === "RESOURCE_MANAGER";
  const isCompanyManager = user.role === "COMPANY_MANAGER";
  const isFinance = user.role === "FINANCE";
  const [result, members, rawChannels] = await Promise.all([
    loadChannelAnalysis(scope, today),
    isResourceManager ? Promise.resolve([]) : db.user.findMany({ where: { groupId: { in: scope.groupIds }, role: { in: ["LEAD", "RECEPTION"] }, ...(scope.includeInactive ? {} : { active: true }) }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    db.channel.findMany({ where: { groupId: { in: scope.groupIds }, ...(scope.channelIds ? { id: { in: scope.channelIds } } : {}) }, select: { normalizedName: true, name: true, active: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  const channels = [...new Map(rawChannels.map((channel) => [channel.normalizedName, channel])).values()];
  const filterGroups = readableGroups.map((group) => ({ ...group, name: `${group.department.name} / ${group.name}` }));
  const preserved = { departmentId: scope.departmentId, groupId: scope.groupId, memberId: scope.memberId, normalizedName: scope.normalizedName, includeInactive: scope.includeInactive };
  const resourceView = isResourceManager || isFinance;
  return <main className="page-shell workflow-wide-page data-center-page space-y-2"><div className="page-heading"><div><h1 className="page-title">{user.role === "LEAD" ? "渠道与批次" : "渠道表现"}</h1><p className="page-description">{resourceView ? "按渠道看添加数据、有效数据、撞粉、低金额和无 WS 号码；客户回复和员工执行分开看。" : "比较来源质量；撞粉、低金额和无 WS 号码已经在渠道表中按渠道展示。"}</p></div></div>{user.role === "LEAD" ? <LeadWorkspaceTabs kind="acquisition" /> : null}<LeadDateRangeFilter pathname="/channel-analysis" range={dateRange} today={today} preserve={preserved} ariaLabel="渠道分析时间范围" /><AnalysisFilters action="/channel-analysis" visible={resourceView ? { department: true, group: true, channel: true } : isCompanyManager ? { group: true, channel: true } : { group: user.role === "ADMIN", member: true, includeInactive: true }} primary={resourceView ? ["department", "group", "channel"] : isCompanyManager ? ["group", "channel"] : user.role === "ADMIN" ? ["group", "member"] : ["member"]} options={{ departments, groups: filterGroups, members, channels }} values={scope} preserve={{ range: dateRange.preset, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }} compact /><AnalysisFilterNotice message={scope.filterWarning} /><ChannelQualityTable rows={result.rows} filters={scope} resourceMode={resourceView} /><ChannelDetailDrawer detail={result.selectedChannelDetail} filters={scope} showBatchLink={!resourceView && !isCompanyManager} /></main>;
}
