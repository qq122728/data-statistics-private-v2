import { redirect } from "next/navigation";
import { HeadquartersPerformanceLeaderboard } from "../../../components/analytics/overview/HeadquartersPerformanceLeaderboard";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { loadPerformanceLeaderboard } from "../../../lib/analytics/performance-leaderboard-query";
import { resolveAnalysisScope } from "../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { statisticsDate } from "../../../lib/statistics-date";
import { db } from "../../../lib/db";
import { resolveLeadDateRange } from "../../../lib/lead-date-range";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { resolveReadableReportGroups } from "../../../lib/report-scope";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function PerformanceLeaderboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/performance-leaderboard");
    throw error;
  }

  const [raw, settings, groups] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({ select: { id: true, departmentId: true, countryCode: true, department: { select: { countryCode: true, companyId: true } } }, orderBy: { name: "asc" } }),
  ]);
  const userTimezone = await resolveUserBusinessTimezone(user, settings.timezone);
  const now = new Date();
  const today = statisticsDate(now);
  const updatedAtLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: userTimezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => {
    const current = first(value);
    return current === undefined ? [] : [[key, current]];
  }));
  const range = resolveLeadDateRange(
    rawValues.range || rawValues.sourceDateFrom || rawValues.sourceDateTo
      ? rawValues
      : { ...rawValues, range: "month" },
    today,
  );
  const publicDateFilters = {
    sourceDateFrom: range.from,
    sourceDateTo: range.to,
  };
  // 普通成员仍可查看公开小组榜；资源部、公司管理员和部门管理员必须遵守各自数据范围。
  const scopedUser = user.role === "RESOURCE_MANAGER" || user.role === "COMPANY_MANAGER" ? user : { ...user, role: "ADMIN" as const };
  const readableGroups = resolveReadableReportGroups(scopedUser, groups);
  const scope = resolveAnalysisScope(
    scopedUser,
    publicDateFilters,
    today,
    readableGroups.map((group) => group.id),
  );
  const leaderboardRows = await loadPerformanceLeaderboard({
    groupIds: scope.groupIds,
    sourceDateFrom: scope.sourceDateFrom,
    sourceDateTo: scope.sourceDateTo,
    today,
    channelIds: scope.channelIds,
  });

  return <main className="page-shell leaderboard-page space-y-3">
    <div className="page-heading leaderboard-page-heading">
      <div>
        <h1 className="page-title">精英榜</h1>
        <p className="page-description">{user.role === "RESOURCE_MANAGER" ? "按当前账号获授权的渠道汇总小组排名，不展示未授权渠道、客户或个人资料。" : user.role === "COMPANY_MANAGER" ? user.managementCountryCode ? "只展示当前部门市场内的小组排名，不展示其他市场。" : "只展示本公司的小组排名，不展示其他公司。" : "所有成员看到同一份小组榜单：全部公司、国家的小组统一参加单量榜和业绩榜，不展示客户或个人资料。"}</p>
        <p className="management-freshness">金额统一为 USD · 数据范围更新至 {today}</p>
      </div>
      <LeadDateRangeFilter pathname="/performance-leaderboard" range={range} today={today} ariaLabel="精英榜时间范围" />
    </div>
    <HeadquartersPerformanceLeaderboard performanceRows={leaderboardRows} filters={scope} updatedAtLabel={updatedAtLabel} allowDrilldown={["ADMIN", "COMPANY_MANAGER", "LEAD"].includes(user.role)} />
  </main>;
}
