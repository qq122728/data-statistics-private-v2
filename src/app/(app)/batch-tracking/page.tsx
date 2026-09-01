import { redirect } from "next/navigation";
import { AnalysisFilters } from "../../../components/analytics/AnalysisFilters";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { BatchTrackingTable } from "../../../components/analytics/batch/BatchTrackingTable";
import { loadBatchTracking } from "../../../lib/analytics/batch-tracking";
import { parseAnalysisFilters, resolveAnalysisScope } from "../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { statisticsDate } from "../../../lib/statistics-date";
import { db } from "../../../lib/db";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { getSystemSettings } from "../../../lib/settings";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function BatchTrackingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/batch-tracking"); throw error; }
  if (user.role !== "ADMIN" && user.role !== "LEAD") redirect("/dashboard");
  const [raw, settings, groups] = await Promise.all([searchParams, getSystemSettings(), db.teamGroup.findMany({ select: { id: true, name: true, active: true, departmentId: true, department: { select: { companyId: true } } }, orderBy: { name: "asc" } })]);
  const today = statisticsDate();
  const readableGroups = resolveReadableReportGroups(user, groups);
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => first(value) === undefined ? [] : [[key, first(value)!]]));
  const parsed = parseAnalysisFilters(new URLSearchParams(rawValues));
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const scope = resolveAnalysisScope(user, { ...parsed, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }, today, readableGroups.map((group) => group.id));
  const [result, members, channels] = await Promise.all([
    loadBatchTracking(scope, today),
    db.user.findMany({ where: { groupId: { in: scope.groupIds }, role: { in: ["LEAD", "RECEPTION"] }, ...(scope.includeInactive ? {} : { active: true }) }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
    db.channel.findMany({ where: { groupId: { in: scope.groupIds } }, select: { normalizedName: true, name: true, active: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  const channelOptions = [...new Map(channels.map((channel) => [channel.normalizedName, channel])).values()];
  const preserved = { groupId: scope.groupId, memberId: scope.memberId, normalizedName: scope.normalizedName, includeInactive: scope.includeInactive };
  return <main className="page-shell space-y-4"><div className="page-heading"><div><h1 className="page-title">批次追踪</h1><p className="page-description">先处理数据异常和停滞批次，再查看正常推进和已开单批次。</p></div></div>{user.role === "LEAD" ? <LeadWorkspaceTabs kind="acquisition" /> : null}<LeadDateRangeFilter pathname="/batch-tracking" range={dateRange} today={today} preserve={preserved} ariaLabel="批次追踪时间范围" /><AnalysisFilters action="/batch-tracking" visible={{ group: user.role === "ADMIN", member: true, channel: true, includeInactive: true }} primary={["member", "channel", "group"]} options={{ groups: readableGroups, members, channels: channelOptions }} values={scope} preserve={{ range: dateRange.preset, sourceDateFrom: dateRange.from, sourceDateTo: dateRange.to }} compact /><AnalysisFilterNotice message={scope.filterWarning} /><BatchTrackingTable rows={result.rows} filters={scope} showGroup={user.role === "ADMIN"} /></main>;
}
