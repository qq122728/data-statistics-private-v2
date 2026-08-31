import { redirect } from "next/navigation";
import { ManagementDepartmentRankings } from "../../../components/analytics/overview/ManagementDepartmentRankings";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { loadPerformanceLeaderboard } from "../../../lib/analytics/performance-leaderboard-query";
import { resolveAnalysisScope } from "../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { resolveLeadDateRange } from "../../../lib/lead-date-range";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { resolveReadableReportGroups } from "../../../lib/report-scope";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function ManagementRankingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/management-rankings");
    throw error;
  }
  if (user.role !== "ADMIN" && user.role !== "COMPANY_MANAGER") redirect("/dashboard");
  const [raw, settings, groups] = await Promise.all([searchParams, getSystemSettings(), db.teamGroup.findMany({ select: { id: true, departmentId: true, countryCode: true, department: { select: { countryCode: true, companyId: true } } } })]);
  const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
  const today = localDateYYYYMMDD(new Date(), timezone);
  const values = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => {
    const current = first(value);
    return current === undefined ? [] : [[key, current]];
  }));
  const range = resolveLeadDateRange(values.range || values.sourceDateFrom || values.sourceDateTo ? values : { ...values, range: "month" }, today);
  const readableGroups = resolveReadableReportGroups(user, groups);
  const scope = resolveAnalysisScope(user, { sourceDateFrom: range.from, sourceDateTo: range.to }, today, readableGroups.map((group) => group.id));
  const rows = await loadPerformanceLeaderboard({ groupIds: scope.groupIds, sourceDateFrom: scope.sourceDateFrom, sourceDateTo: scope.sourceDateTo, today });
  return <main className="page-shell leaderboard-page space-y-3"><div className="page-heading leaderboard-page-heading"><div><h1 className="page-title">全部门完整榜单</h1><p className="page-description">总公司管理员查看全部公司；公司管理员只看本公司；部门管理员只看自己负责的市场。</p><p className="management-freshness">金额统一为 USD · 数据范围更新至 {today}</p></div><LeadDateRangeFilter pathname="/management-rankings" range={range} today={today} ariaLabel="完整榜单时间范围" /></div><ManagementDepartmentRankings performanceRows={rows} /></main>;
}
