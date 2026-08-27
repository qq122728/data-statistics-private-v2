import { redirect } from "next/navigation";
import { AnalysisFilters } from "../../../components/analytics/AnalysisFilters";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { MemberDailyDetail } from "../../../components/analytics/member/MemberDailyDetail";
import {
  MemberOverviewTabs,
  type MemberOverviewQuery,
  type MemberOverviewTab,
} from "../../../components/analytics/member/MemberOverviewTabs";
import { RiskAlerts } from "../../../components/analytics/member/RiskAlerts";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { loadMemberOverview } from "../../../lib/analytics/member-overview";
import { loadMemberDailyDetail, type DailyMemberRole } from "../../../lib/analytics/member-daily-detail";
import { resolveMemberPeriods } from "../../../lib/analytics/member-periods";
import {
  parseAnalysisFilters,
  resolveAnalysisScope,
} from "../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { getRiskSettings, getSystemSettings } from "../../../lib/settings";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
const validTabs = new Set<MemberOverviewTab>([
  "reception",
  "operator",
  "expert",
  "risk",
]);

export default async function MemberOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      redirect("/login?next=/anomaly-ranking");
    throw error;
  }
  if (user.role !== "ADMIN" && user.role !== "RESOURCE_MANAGER" && user.role !== "COMPANY_MANAGER" && user.role !== "LEAD") redirect("/dashboard");

  const [raw, settings, allGroups, departments] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({
      select: { id: true, name: true, active: true, departmentId: true, countryCode: true, department: { select: { name: true, countryCode: true } } },
      orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const today = localDateYYYYMMDD(new Date(), settings.timezone);
  const readableGroups = resolveReadableReportGroups(user, allGroups);
  const rawValues = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) =>
      first(value) === undefined ? [] : [[key, first(value)!]],
    ),
  );
  const parsed = parseAnalysisFilters(new URLSearchParams(rawValues));
  // 成员明细用于看员工当前执行，默认按当月实际日期，而不是排除最近七天的“成熟来源日”。
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const detailFilters = {
    ...parsed,
    period: "custom" as const,
    sourceDateFrom: dateRange.from,
    sourceDateTo: dateRange.to,
  };
  const filteredReadableGroups = parsed.departmentId
    ? readableGroups.filter((group) => group.departmentId === parsed.departmentId)
    : readableGroups;
  const initialScope = resolveAnalysisScope(
    user,
    detailFilters,
    today,
    filteredReadableGroups.map((group) => group.id),
  );
  const periods = resolveMemberPeriods(initialScope, today);
  const scope = {
    ...initialScope,
    period: periods.period,
    sourceDateFrom: periods.current.sourceDateFrom,
    sourceDateTo: periods.current.sourceDateTo,
    filterWarning: initialScope.filterWarning ?? periods.warning ?? undefined,
  };
  const requestedTab = first(raw.tab) as MemberOverviewTab | undefined;
  const activeTab = requestedTab && validTabs.has(requestedTab) ? requestedTab : "reception";
  const pageTitle = activeTab === "reception" ? "接粉成员每日明细" : activeTab === "operator" ? "炒群成员每日明细" : activeTab === "expert" ? "专家成员每日明细" : "风险预警";
  const pageDescription = activeTab === "risk"
    ? "按公司、小组和渠道筛选需要人工关注的表现、财务和数据风险。"
    : "先选择岗位，再在下方选择成员，即可查看该成员每天负责的流程数据；不展示客户号码。";
  const dailyRole: DailyMemberRole | null = activeTab === "reception"
    ? "RECEPTION"
    : activeTab === "operator"
      ? "GROUP_OPERATOR"
      : activeTab === "expert"
        ? "EXPERT"
        : null;
  const [result, members, channels, riskSettings, selectedMemberDaily] = await Promise.all([
    loadMemberOverview(scope, today),
    db.user.findMany({
      where: {
        groupId: { in: scope.groupIds },
        ...(dailyRole
          ? {
              // 主岗位和兼任岗位都应进入相应的成员名单；专家视图还保留
              // 本组组长，因为组长可以作为默认专家负责人接待客户。
              OR: [
                { role: dailyRole },
                { roleAssignments: { some: { role: dailyRole } } },
                ...(dailyRole === "EXPERT" ? [{ role: "LEAD" as const }] : []),
              ],
            }
          : { role: { in: ["LEAD", "RECEPTION"] } }),
        ...(scope.includeInactive ? {} : { active: true }),
      },
      select: { id: true, name: true, active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.channel.findMany({
      where: { groupId: { in: scope.groupIds }, ...(scope.channelIds ? { id: { in: scope.channelIds } } : {}) },
      select: { normalizedName: true, name: true, active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    getRiskSettings(),
    dailyRole
      ? loadMemberDailyDetail({
          groupIds: scope.groupIds,
          memberId: scope.memberId,
          role: dailyRole,
          from: scope.sourceDateFrom,
          to: scope.sourceDateTo,
          channelIds: scope.channelIds,
          normalizedName: scope.normalizedName,
        })
      : Promise.resolve(null),
  ]);
  const channelOptions = [
    ...new Map(
      channels.map((channel) => [channel.normalizedName, channel]),
    ).values(),
  ];
  const query: MemberOverviewQuery = {
    tab: activeTab,
    period: periods.period,
    departmentId: scope.departmentId,
    groupId: scope.groupId,
    memberId: scope.memberId,
    normalizedName: scope.normalizedName,
    sourceDateFrom:
      periods.period === "custom" ? periods.current.sourceDateFrom : undefined,
    sourceDateTo:
      periods.period === "custom" ? periods.current.sourceDateTo : undefined,
    includeInactive: scope.includeInactive ? "1" : undefined,
  };
  const fixedGroupName =
    user.role === "LEAD"
      ? readableGroups.find((group) => group.id === user.groupId)?.name
      : undefined;
  return (
    <main className="page-shell workflow-wide-page data-center-page member-overview-page space-y-2">
      <div className="page-heading member-overview-heading">
        <div>
          <h1 className="page-title">{pageTitle}</h1>
          <p className="page-description">{pageDescription}</p>
        </div>
      </div>
      {user.role === "LEAD" ? <LeadWorkspaceTabs kind="team" /> : null}
      {dailyRole ? <MemberOverviewTabs activeTab={activeTab} query={query} /> : null}
      <LeadDateRangeFilter
        pathname="/anomaly-ranking"
        range={dateRange}
        today={today}
        ariaLabel="成员明细时间范围"
        preserve={{
          tab: activeTab,
          departmentId: scope.departmentId,
          groupId: scope.groupId,
          memberId: scope.memberId,
          normalizedName: scope.normalizedName,
          includeInactive: scope.includeInactive,
        }}
      />
      <AnalysisFilters
        action="/anomaly-ranking"
        visible={{
          department: user.role === "ADMIN" || user.role === "RESOURCE_MANAGER",
          group: user.role !== "LEAD",
          channel: true,
          member: Boolean(dailyRole) || activeTab === "risk",
          includeInactive: true,
        }}
        primary={
          user.role !== "LEAD" && activeTab === "risk"
            ? ["period", "group", "member"]
            : ["period", "member", "channel"]
        }
        options={{ departments, groups: readableGroups.map((group) => ({ ...group, name: `${group.department.name} / ${group.name}` })), members, channels: channelOptions }}
        values={scope}
        fixedGroupName={fixedGroupName}
        compact
        memberEmptyLabel={dailyRole ? "请选择成员" : undefined}
        preserve={{
          tab: activeTab,
          range: dateRange.preset,
          sourceDateFrom: dateRange.from,
          sourceDateTo: dateRange.to,
        }}
      />
      <AnalysisFilterNotice message={scope.filterWarning} />
      {scope.requestedForbiddenGroup ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          请求的小组不在你的可查看范围内。
        </p>
      ) : null}
      {dailyRole && !selectedMemberDaily ? <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center"><h2 className="m-0 text-base font-semibold text-slate-900">请选择一位成员</h2><p className="mb-0 mt-2 text-sm text-slate-600">请先在上方选择成员，系统会显示该成员每天的执行明细。</p></section> : null}
      {selectedMemberDaily ? <MemberDailyDetail detail={selectedMemberDaily} /> : null}
      {activeTab === "risk" ? (
        <RiskAlerts
          rows={result.rows}
          role={user.role}
          riskSettings={riskSettings}
          query={query}
        />
      ) : null}
    </main>
  );
}
