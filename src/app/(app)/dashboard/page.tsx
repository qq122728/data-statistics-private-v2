import type { User } from "@prisma/client";
import { redirect } from "next/navigation";
import { AnalysisFilters } from "../../../components/analytics/AnalysisFilters";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { OverviewAlerts } from "../../../components/analytics/overview/OverviewAlerts";
import { OverviewSummary } from "../../../components/analytics/overview/OverviewSummary";
import { ManagementCommandCenter } from "../../../components/analytics/overview/ManagementCommandCenter";
import { HeadquartersCommandCenter } from "../../../components/analytics/overview/HeadquartersCommandCenter";
import { ResourceCommandCenter } from "../../../components/analytics/overview/ResourceCommandCenter";
import { CompanyCommandCenter } from "../../../components/analytics/overview/CompanyCommandCenter";
import {
  RoleTaskDashboard,
  type RoleTaskQueue,
} from "../../../components/dashboard/RoleTaskDashboard";
import { AuthenticationError, requireUser, type SessionUser } from "../../../lib/auth";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { loadManagementOverview } from "../../../lib/analytics/overview";
import {
  buildAnalysisHref,
  parseAnalysisFilters,
  resolveAnalysisScope,
} from "../../../lib/analytics/scope";
import {
  resolveReadableReportGroups,
  resolveSelectedReportGroupIds,
} from "../../../lib/report-scope";
import { getSystemSettings } from "../../../lib/settings";
import { leadDateRangeQuery, resolveDateRangeWithDefault, resolveLeadDateRange } from "../../../lib/lead-date-range";
import { LeadDashboardToolbar } from "../../../components/lead/LeadDashboardToolbar";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { LeadManagementSummary } from "../../../components/lead/LeadManagementSummary";
import { buildLeadManagementSummary, type LeadBottleneckRow, type LeadRoleGradeCard } from "../../../lib/lead-management-summary";
import { standardsFromGroup } from "../../../lib/conversion-standards";
import { loadResourceWorkspace } from "../../../lib/analytics/resource-workspace";
import { loadCompanyWorkspace } from "../../../lib/analytics/company-workspace";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { hasAssignedRole } from "../../../lib/role-access";
import { resolveAccessibleReceptionistIds } from "../../../lib/group-operator-collaboration";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      redirect("/login?next=/dashboard");
    throw error;
  }
  const raw = await searchParams;
  if (user.role === "RECEPTION") return renderMemberDashboard(user, raw);
  if (user.role === "GROUP_OPERATOR") return renderGroupOperatorDashboard(user);
  if (user.role === "EXPERT") return renderExpertDashboard(user);
  if (user.role === "HR") redirect("/personnel");
  return renderManagementDashboard(user, raw);
}

async function renderManagementDashboard(user: User, raw: SearchParams) {
  const [settings, allGroups, departments] = await Promise.all([
    getSystemSettings(),
    db.teamGroup.findMany({
      select: { id: true, name: true, active: true, departmentId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, department: { select: { name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, companyId: true } } },
      orderBy: { name: "asc" },
    }),
    db.department.findMany({ where: { active: true }, select: { id: true, name: true, active: true }, orderBy: { name: "asc" } }),
  ]);
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const allReadableGroups = resolveReadableReportGroups(user, allGroups);
  const rawValues = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) => {
      const current = first(value);
      return current === undefined ? [] : [[key, current]];
    }),
  );
  const isLead = user.role === "LEAD";
  const isResourceManager = user.role === "RESOURCE_MANAGER";
  const isCompanyManager = user.role === "COMPANY_MANAGER";
  // 所有看板都是当月经营统计；用户点日期按钮后才改为所选范围。
  const leadRange = resolveLeadDateRange(rawValues.range || rawValues.sourceDateFrom || rawValues.sourceDateTo ? rawValues : { ...rawValues, range: "month" }, today);
  const managementRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const parsedFilters = parseAnalysisFilters(new URLSearchParams(rawValues));
  const departmentGroups = parsedFilters.departmentId
    ? allReadableGroups.filter((group) => group.departmentId === parsedFilters.departmentId)
    : allReadableGroups;
  const readableGroups = parsedFilters.countryCode
    ? departmentGroups.filter((group) => (group.countryCode || group.department.countryCode) === parsedFilters.countryCode)
    : departmentGroups;
  const scope = resolveAnalysisScope(
    user,
    { ...parsedFilters, sourceDateFrom: isLead ? leadRange.from : managementRange.from, sourceDateTo: isLead ? leadRange.to : managementRange.to },
    today,
    readableGroups.map((group) => group.id),
  );
  const resourceDailyMode = rawValues.resourceView === "activity" ? "activity" as const : "source" as const;
  const [overview, members, rawChannels, leadTasks, resourceWorkspace, companyWorkspace] = await Promise.all([
    loadManagementOverview(scope, today),
    db.user.findMany({
      where: {
        groupId: { in: scope.groupIds },
        role: "RECEPTION",
        ...(scope.includeInactive ? {} : { active: true }),
      },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    }),
    db.channel.findMany({
      where: { groupId: { in: scope.groupIds }, ...(scope.channelIds ? { id: { in: scope.channelIds } } : {}) },
      select: { normalizedName: true, name: true, active: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    user.role === "LEAD" ? loadLeadManagementSnapshot(user, today, { sourceDateFrom: scope.sourceDateFrom, sourceDateTo: scope.sourceDateTo, memberId: scope.memberId, normalizedName: scope.normalizedName }) : Promise.resolve({ cards: [], bottlenecks: [] }),
    isResourceManager ? loadResourceWorkspace(scope, today, resourceDailyMode) : Promise.resolve(null),
    isCompanyManager ? loadCompanyWorkspace(scope, today) : Promise.resolve(null),
  ]);
  const channels = [
    ...new Map(
      rawChannels.map((channel) => [channel.normalizedName, channel]),
    ).values(),
  ];
  const filterGroups = readableGroups.map((group) => ({ ...group, name: `${group.department.name} / ${countryName(group.countryCode || group.department.countryCode || "ZZ")} / ${group.name}` }));
  const countryOptions = [...new Set(departmentGroups.map((group) => group.countryCode || group.department.countryCode).filter((code): code is string => Boolean(code)))].sort().map((code) => ({ code, name: countryName(code) }));
  return (
    <main className={`page-shell ${isLead ? "lead-dashboard space-y-3" : "space-y-4"}`}>
      <div className="page-heading">
        <div>
          <h1 className="page-title">{isLead ? "组长工作台" : isResourceManager ? "资源工作台" : isCompanyManager ? "公司工作台" : "总公司工作台"}</h1>
          <p className="page-description">
            {isLead
              ? "聚焦组员数据是否完整、客户流程是否卡住，以及批次数据是否异常。"
              : isResourceManager
                ? "比较下属公司和小组的资源质量、成熟转化与异常掉点，只展示聚合数据。"
                : isCompanyManager
                  ? "查看本公司所有小组的经营结果、团队执行和渠道表现，不会看到其他下属公司。"
                : "按号码导入日期筛选，查看这些号码后续产生的回复、进群、开单、资金结果和全局风险。"}
          </p>
          {!isLead ? <p className="management-freshness">数据范围更新至 {today} · 金额统一为 USD</p> : null}
        </div>
      </div>
      {isLead ? <LeadDashboardToolbar range={leadRange} today={today} members={members} channels={channels} values={{ memberId: scope.memberId, normalizedName: scope.normalizedName, includeInactive: scope.includeInactive }} /> : <>
        <LeadDateRangeFilter
          pathname="/dashboard"
          range={managementRange}
          today={today}
          preserve={{ departmentId: scope.departmentId, countryCode: scope.countryCode, groupId: scope.groupId, normalizedName: scope.normalizedName, ...(isResourceManager ? { resourceView: resourceDailyMode } : {}) }}
          ariaLabel="管理工作台时间范围"
        />
        <AnalysisFilters
          action="/dashboard"
          visible={{ department: isResourceManager || user.role === "ADMIN", country: !isLead, group: true, channel: isResourceManager || isCompanyManager }}
          primary={isResourceManager || user.role === "ADMIN" ? ["department", "country", "group"] : isCompanyManager ? ["country", "group", "channel"] : ["group"]}
          options={{ departments, countries: countryOptions, groups: filterGroups, members, channels }}
          values={scope}
          preserve={{ range: managementRange.preset, sourceDateFrom: managementRange.from, sourceDateTo: managementRange.to, ...(isResourceManager ? { resourceView: resourceDailyMode } : {}) }}
          compact
        />
      </>}
      <AnalysisFilterNotice message={scope.filterWarning} />
      {scope.requestedForbiddenGroup ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          请求的小组不在你的可查看范围内。
        </p>
      ) : null}
      {isLead ? <>
        <LeadManagementSummary cards={leadTasks.cards} rows={leadTasks.bottlenecks} />
        <OverviewAlerts overview={overview} filters={scope} customerHref="/history" role="LEAD" includeCustomerAlerts={false} compact />
        <OverviewSummary overview={overview} compact />
      </> : isResourceManager && resourceWorkspace ? (
        <ResourceCommandCenter overview={overview} workspace={resourceWorkspace} filters={scope} dailyMode={resourceDailyMode} />
      ) : isCompanyManager && companyWorkspace ? (
        <CompanyCommandCenter overview={overview} workspace={companyWorkspace} filters={scope} />
      ) : user.role === "ADMIN" ? (
        <HeadquartersCommandCenter overview={overview} filters={scope} />
      ) : (
        <ManagementCommandCenter
          overview={overview}
          filters={scope}
          role={isCompanyManager ? "COMPANY_MANAGER" : "ADMIN"}
        />
      )}
      {user.role !== "ADMIN" ? <div className="flex justify-end gap-3">
        <a
          className="text-sm font-semibold text-[#0b66ff]"
          href={buildAnalysisHref(isResourceManager ? "/channel-analysis" : "/team-performance", scope)}
        >
          {isLead ? "查看组员对比" : isResourceManager ? "查看渠道表现" : "查看团队表现"}
        </a>
        {isResourceManager ? <a className="text-sm font-semibold text-[#0b66ff]" href={buildAnalysisHref("/resource-conversion", scope)}>查看入群后跟进</a> : null}
        {!isResourceManager ? <a
          className="text-sm font-semibold text-[#0b66ff]"
          href={buildAnalysisHref("/channel-analysis", scope)}
        >
          {isLead ? "查看渠道对比" : "查看渠道分析"}
        </a> : null}
        {!isResourceManager && !isCompanyManager ? <a
          className="text-sm font-semibold text-[#0b66ff]"
          href={
            isLead
              ? `/group-customers?${leadDateRangeQuery(leadRange)}`
              : buildAnalysisHref("/batch-tracking", scope)
          }
        >
          {isLead ? "查看炒群明细" : "查看批次追踪"}
        </a> : null}
      </div> : null}
    </main>
  );
}

async function renderGroupOperatorDashboard(user: SessionUser) {
  const settings = await getSystemSettings();
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const pairedReceptionistIds = (
    await db.groupOperatorReception.findMany({
      where: { groupOperatorId: user.id },
      select: { receptionistId: true },
    })
  ).map((item) => item.receptionistId);
  const receptionistIds = resolveAccessibleReceptionistIds({
    operatorId: user.id,
    pairedReceptionistIds,
    isReceptionist: hasAssignedRole(user, "RECEPTION"),
  });
  const leads = receptionistIds.length
    ? await db.leadCustomer.findMany({
        where: {
          OR: [
            { groupOperatorOwnerId: user.id },
            { groupOperatorOwnerId: null, ownerId: { in: receptionistIds } },
          ],
          batch: { groupId: user.groupId ?? "__none__" },
          invalid: false,
          groupStatus: { in: ["JOINED", "LEFT"] },
        },
        select: {
          id: true,
          phone: true,
          customerName: true,
          groupStatus: true,
          joinedOn: true,
          leftOn: true,
          expertIntroducedOn: true,
          notes: true,
          owner: { select: { name: true } },
          batch: { select: { sourceDate: true, channel: { select: { name: true } } } },
        },
        orderBy: [{ updatedAt: "desc" }],
      })
    : [];
  const toRow = (lead: (typeof leads)[number], status: string) => ({
    id: lead.id,
    phone: lead.phone,
    customerName: lead.customerName,
    ownerName: lead.owner.name,
    source: `${lead.batch.sourceDate} · ${lead.batch.channel.name}`,
    status,
    lastAction: lead.groupStatus === "LEFT" ? `退群 ${lead.leftOn ?? "—"}` : `入群 ${lead.joinedOn ?? "—"}`,
  });
  const newlyJoined = leads.filter((lead) => lead.groupStatus === "JOINED" && !lead.expertIntroducedOn && lead.joinedOn === today);
  const waitingExpert = leads.filter((lead) => lead.groupStatus === "JOINED" && !lead.expertIntroducedOn && lead.joinedOn !== today);
  const left = leads.filter((lead) => lead.groupStatus === "LEFT");
  const queues: RoleTaskQueue[] = [
    { key: "joined", label: "在群待跟进", description: "今天新入群，先观察并补充群内情况", href: "/group-customers", rows: newlyJoined.map((lead) => toRow(lead, lead.notes || "今天新入群")), tone: "blue" },
    { key: "expert", label: "待推专家", description: "已在群但尚未推专家", href: "/group-customers", rows: waitingExpert.map((lead) => toRow(lead, lead.notes || "等待推专家")), tone: "amber" },
    { key: "left", label: "退群关注", description: "核对退群情况，发现误点可撤销", href: "/group-customers", rows: left.map((lead) => toRow(lead, lead.notes || "已退群，需核对")), tone: "red" },
  ];
  return <RoleTaskDashboard title="炒群今日待办" description={receptionistIds.length ? `仅显示组长分配给你的 ${receptionistIds.length} 位前台接粉客户。` : "组长尚未给你配置配合的前台接粉员。"} queues={queues} emptyMessage="当前没有需要炒群跟进的客户。" />;
}

async function renderExpertDashboard(user: User) {
  const settings = await getSystemSettings();
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const leads = await db.leadCustomer.findMany({
    where: {
      expertOwnerId: user.id,
      invalid: false,
      expertIntroducedOn: { not: null },
    },
    select: {
      id: true,
      phone: true,
      customerName: true,
      expertIntroducedOn: true,
      expertContactedOn: true,
      expertWorkflowStage: true,
      expertTrackingStartedAt: true,
      registeredOn: true,
      nextPlan: true,
      nextFollowUpOn: true,
      owner: { select: { name: true } },
      batch: { select: { sourceDate: true, channel: { select: { name: true } } } },
      customerOrder: { select: { openedOn: true, voidedAt: true, events: { where: { voidedAt: null }, select: { occurredOn: true }, orderBy: { occurredOn: "desc" }, take: 1 } } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  const activeOrder = (lead: (typeof leads)[number]) => Boolean(lead.customerOrder && !lead.customerOrder.voidedAt);
  const toRow = (lead: (typeof leads)[number], status: string) => ({
    id: lead.id,
    phone: lead.phone,
    customerName: lead.customerName,
    ownerName: lead.owner.name,
    source: `${lead.batch.sourceDate} · ${lead.batch.channel.name}`,
    status,
    lastAction: lead.customerOrder?.events[0]?.occurredOn
      ? `资金 ${lead.customerOrder.events[0].occurredOn}`
      : lead.registeredOn
        ? `注册 ${lead.registeredOn}`
        : `介绍 ${lead.expertIntroducedOn ?? "—"}`,
  });
  const queued = leads.filter((lead) => lead.expertWorkflowStage === "QUEUED" || (!lead.expertWorkflowStage && !lead.expertContactedOn));
  const materials = leads.filter((lead) => lead.expertWorkflowStage === "MATERIALS");
  const tracking = leads.filter((lead) => lead.expertWorkflowStage === "TRACKING" || (!lead.expertWorkflowStage && Boolean(lead.expertContactedOn) && !lead.registeredOn));
  const trackingOverdue = tracking.filter((lead) => lead.expertTrackingStartedAt && Date.now() - lead.expertTrackingStartedAt.getTime() >= 48 * 60 * 60 * 1000);
  const waitingRegister = leads.filter((lead) => lead.expertWorkflowStage === "PENDING_REGISTRATION" || (!lead.expertWorkflowStage && !lead.registeredOn && Boolean(lead.expertContactedOn)));
  const waitingOrder = leads.filter((lead) => lead.expertWorkflowStage === "PENDING_ORDER" || (!lead.expertWorkflowStage && lead.registeredOn && !activeOrder(lead)));
  const overdue = leads.filter((lead) => lead.nextFollowUpOn && lead.nextFollowUpOn < today);
  const ordered = leads.filter(activeOrder);
  const queues: RoleTaskQueue[] = [
    { key: "queued", label: "排队中", description: "炒群已推专家，等待你开始接待", href: "/expert-customers", rows: queued.map((lead) => toRow(lead, lead.nextPlan || "开始专家接待")), tone: "blue" },
    { key: "materials", label: "交资料", description: "已接待，等待客户交资料", href: "/expert-customers", rows: materials.map((lead) => toRow(lead, lead.nextPlan || "提醒客户交资料")), tone: "amber" },
    { key: "tracking", label: "追踪超时", description: "资料已交后超过 48 小时仍未转为待注册", href: "/expert-customers", rows: trackingOverdue.map((lead) => toRow(lead, "已超过 48 小时，请处理或更新阶段")), tone: "red" },
    { key: "register", label: "待注册", description: "追踪完成，等待完成注册", href: "/expert-customers", rows: waitingRegister.map((lead) => toRow(lead, lead.nextPlan || "跟进完成注册")), tone: "blue" },
    { key: "order", label: "待开单", description: "已注册，等待首充并登记开单", href: "/expert-customers", rows: waitingOrder.map((lead) => toRow(lead, lead.nextPlan || "跟进首充开单")), tone: "amber" },
    { key: "overdue", label: "计划逾期", description: "下一步计划日期已经超过今天", href: "/expert-customers", rows: overdue.map((lead) => toRow(lead, `${lead.nextFollowUpOn} · ${lead.nextPlan || "计划已逾期"}`)), tone: "red" },
    { key: "ordered", label: "已开单待跟进", description: "继续跟进续充，发生出金及时登记", href: "/expert-customers", rows: ordered.map((lead) => toRow(lead, lead.nextPlan || "跟进续充 / 出金")), tone: "emerald" },
  ];
  return <RoleTaskDashboard title="专家今日待办" description="只显示分配给你的专家客户；从排队、交资料、48 小时追踪到注册、开单和资金都在同一页继续处理。" queues={queues} emptyMessage="当前没有需要专家跟进的客户。" />;
}

async function loadLeadManagementSnapshot(user: User, today: string, filters: { sourceDateFrom: string; sourceDateTo: string; memberId?: string; normalizedName?: string }): Promise<{ cards: LeadRoleGradeCard[]; bottlenecks: LeadBottleneckRow[] }> {
  const [leads, group] = await Promise.all([db.leadCustomer.findMany({
    where: {
      isHistoricalRecord: false,
      batch: {
        groupId: user.groupId ?? "__none__",
        isHistoricalRecord: false,
        sourceDate: { gte: filters.sourceDateFrom, lte: filters.sourceDateTo },
        ...(filters.normalizedName ? { channel: { normalizedName: filters.normalizedName } } : {}),
      },
      ...(filters.memberId ? { ownerId: filters.memberId } : {}),
    },
    select: {
      id: true,
      invalid: true,
      receptionCategory: true,
      groupStatus: true,
      repliedOn: true,
      joinedOn: true,
      expertIntroducedOn: true,
      expertContactedOn: true,
      expertOwnerId: true,
      registeredOn: true,
      activities: {
        where: { kind: "GROUP_PROGRESS_UPDATED", occurredOn: today },
        select: { id: true },
        take: 1,
      },
      batch: { select: { sourceDate: true } },
    },
  }), db.teamGroup.findUniqueOrThrow({
    where: { id: user.groupId ?? "__none__" },
    select: {
      receptionJoinPassRate: true, receptionJoinGoodRate: true, receptionJoinExcellentRate: true,
      operatorExpertPassRate: true, operatorExpertGoodRate: true, operatorExpertExcellentRate: true,
      expertOrderPassRate: true, expertOrderGoodRate: true, expertOrderExcellentRate: true,
    },
  })]);
  // 资金卡点只需要合计数。由数据库先汇总，不把每位客户的全部流水搬到页面内存。
  const orders = leads.length ? await db.customerOrder.findMany({
    where: { leadId: { in: leads.map((lead) => lead.id) } },
    select: { id: true, leadId: true, initialDepositCents: true, voidedAt: true },
  }) : [];
  const activeOrders = orders.filter((order) => !order.voidedAt && order.leadId);
  const activeOrderIds = activeOrders.map((order) => order.id);
  const [financeTotals, correctedOrders] = activeOrderIds.length ? await Promise.all([
    db.customerFinanceEvent.groupBy({
      by: ["customerOrderId", "kind"],
      where: {
        customerOrderId: { in: activeOrderIds },
        voidedAt: null,
        OR: [
          { kind: "WITHDRAWAL" },
          { kind: "RECHARGE", continuationNumber: { not: null } },
        ],
      },
      _sum: { amountCents: true },
    }),
    db.customerFinanceEvent.groupBy({
      by: ["customerOrderId"],
      where: { customerOrderId: { in: activeOrderIds }, voidedAt: { not: null } },
      _count: { _all: true },
    }),
  ]) : [[], []];
  const totalsByOrder = new Map<string, { recharge: number; withdrawal: number }>();
  for (const total of financeTotals) {
    if (!total.customerOrderId) continue;
    const current = totalsByOrder.get(total.customerOrderId) ?? { recharge: 0, withdrawal: 0 };
    if (total.kind === "RECHARGE") current.recharge += total._sum.amountCents ?? 0;
    if (total.kind === "WITHDRAWAL") current.withdrawal += total._sum.amountCents ?? 0;
    totalsByOrder.set(total.customerOrderId, current);
  }
  const correctedOrderIds = new Set(correctedOrders.flatMap((order) => order.customerOrderId ? [order.customerOrderId] : []));
  const orderByLead = new Map(activeOrders.flatMap((order) => order.leadId ? [[order.leadId, order] as const] : []));
  const abnormalLeadIds = new Set(activeOrders.flatMap((order) => {
    const totals = totalsByOrder.get(order.id) ?? { recharge: 0, withdrawal: 0 };
    return correctedOrderIds.has(order.id) || totals.withdrawal > order.initialDepositCents + totals.recharge
      ? [order.leadId as string]
      : [];
  }));
  return buildLeadManagementSummary(leads.map((lead) => ({
    sourceDate: lead.batch.sourceDate,
    invalid: lead.invalid,
    receptionCategory: lead.receptionCategory,
    repliedOn: lead.repliedOn,
    joinedOn: lead.joinedOn,
    groupStatus: lead.groupStatus,
    expertIntroducedOn: lead.expertIntroducedOn,
    expertContactedOn: lead.expertContactedOn,
    expertOwnerId: lead.expertOwnerId,
    registeredOn: lead.registeredOn,
    hasTodayGroupProgress: lead.activities.length > 0,
    hasActiveOrder: orderByLead.has(lead.id),
    abnormalFinance: abnormalLeadIds.has(lead.id),
  })), today, standardsFromGroup(group));
}

async function renderMemberDashboard(user: User, _raw: SearchParams) {
  const settings = await getSystemSettings();
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const [leads, todayActivities] = await Promise.all([
    db.leadCustomer.findMany({
      where: { ownerId: user.id },
      select: {
        id: true,
        phone: true,
        customerName: true,
        invalid: true,
        repliedOn: true,
        followUpCount: true,
        groupStatus: true,
        batch: {
          select: { sourceDate: true, channel: { select: { name: true } } },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
    db.leadActivity.findMany({
      where: { occurredOn: today, lead: { ownerId: user.id } },
      select: { kind: true },
    }),
  ]);
  const valid = leads.filter((lead) => !lead.invalid);
  const queues = [
    {
      key: "reply",
      label: "待回复",
      description: "新号码尚未回复，先完成首次联系",
      href: "/entry?tab=reply",
      rows: valid.filter((lead) => !lead.repliedOn && lead.followUpCount === 0),
    },
    {
      key: "followUp",
      label: "待回访",
      description: "已经联系过但还没回复，继续回访",
      href: "/entry?tab=reply",
      rows: valid.filter((lead) => !lead.repliedOn && lead.followUpCount > 0),
    },
    {
      key: "group",
      label: "待入群",
      description: "已回复，等待确认是否入群",
      href: "/entry?tab=group",
      rows: valid.filter(
        (lead) => lead.repliedOn && lead.groupStatus === "NOT_JOINED",
      ),
    },
  ] as const;
  const waitingRows = queues
    .flatMap((queue) => queue.rows.slice(0, 2).map((lead) => ({ lead, queue })))
    .slice(0, 8);
  const completed = {
    reply: todayActivities.filter((item) => item.kind === "REPLIED").length,
    followUp: todayActivities.filter((item) => item.kind === "FOLLOWED_UP").length,
    group: todayActivities.filter((item) => item.kind === "JOINED_GROUP")
      .length,
  };
  return (
    <main className="page-shell space-y-4">
      <div className="page-heading">
        <div>
          <h1 className="page-title">今日待办</h1>
          <p className="page-description">
            按客户流程处理下一步；点任一模块会直接打开对应的跟进表。
          </p>
        </div>
        <a
          href="/entry?tab=import"
          className="inline-flex min-h-9 items-center rounded-lg bg-[#0b66ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0757dc]"
        >
          录入新号码
        </a>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {queues.map((queue) => (
          <a
            key={queue.key}
            href={queue.href}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow"
          >
            <p className="m-0 text-sm font-semibold text-slate-700">
              {queue.label}
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {queue.rows.length}
              <span className="ml-1 text-sm font-medium text-slate-400">
                人
              </span>
            </p>
            <p className="mb-0 mt-2 text-xs text-slate-500">
              {queue.description}
            </p>
          </a>
        ))}
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">优先跟进</h2>
              <p className="panel-subtitle">
                每类先展示两位客户，点击后进入对应步骤
              </p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>下一步</th>
                  <th>手机号</th>
                  <th>客户姓名</th>
                  <th>来源</th>
                  <th>已回访</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {waitingRows.map(({ lead, queue }) => (
                  <tr key={`${queue.key}-${lead.id}`}>
                    <td>
                      <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                        {queue.label}
                      </span>
                    </td>
                    <td className="font-semibold">{lead.phone}</td>
                    <td>{lead.customerName ?? "—"}</td>
                    <td>
                      {lead.batch.sourceDate} · {lead.batch.channel.name}
                    </td>
                    <td>{lead.followUpCount || "—"}</td>
                    <td>
                      <a
                        className="font-semibold text-[#0b66ff]"
                        href={queue.href}
                      >
                        去处理
                      </a>
                    </td>
                  </tr>
                ))}
                {!waitingRows.length && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      目前没有待处理客户，可以录入新号码或查看客户跟进。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">今日已完成</h2>
              <p className="panel-subtitle">按实际操作自动统计</p>
            </div>
          </div>
          <dl className="m-0 divide-y divide-slate-100 px-5">
            {[
              ["已回复", completed.reply],
              ["已回访", completed.followUp],
              ["已入群", completed.group],
            ].map(([label, count]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between py-4"
              >
                <dt className="text-sm text-slate-600">{label}</dt>
                <dd className="m-0 text-xl font-bold text-slate-900">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-slate-100 p-5">
            <a
              className="text-sm font-semibold text-[#0b66ff]"
              href="/entry?tab=overview"
            >
              查看我的完整数据 →
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
