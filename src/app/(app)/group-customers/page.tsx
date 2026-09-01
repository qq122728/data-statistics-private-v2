import { redirect } from "next/navigation";
import {
  GroupCustomerTable,
  type GroupCustomer,
} from "../../../components/lead/GroupCustomerTable";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { GroupOperatorPerformanceTable, type GroupOperatorPerformance } from "../../../components/lead/GroupOperatorPerformanceTable";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { statisticsDate } from "../../../lib/statistics-date";
import { resolveLeadDateRange } from "../../../lib/lead-date-range";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { parsePage } from "../../../lib/pagination";
import { Pagination } from "../../../components/ui/Pagination";
import { loadGroupCustomerWorkspace, type GroupCustomerExpertStageFilter, type GroupCustomerLeaveOrder, type GroupCustomerLeaveRisk, type GroupCustomerView } from "../../../lib/customer-queries/group-customers";
import { getAssignedRoles, groupCustomerPageRoles, hasAnyRole, hasAssignedRole } from "../../../lib/role-access";
import { db } from "../../../lib/db";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { Eye } from "@phosphor-icons/react/dist/ssr";
import { autoMarkExpiredGroupMemberships } from "../../../lib/group-lifecycle";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * 需求文档6.1.1：未分配炒群岗这一行不能只看 handled（选中范围内有没有经手记录）——
 * 范围内零经手记录、但手里还有没退群老客户时 handled 是0，只看 handled 会让这行
 * 跟着日期范围时隐时现，是当前在群快照要消灭的问题本身。
 */
export function shouldShowUnassignedRow(summary: { handled: number; inGroup: number }): boolean {
  return Boolean(summary.handled || summary.inGroup);
}

export default async function GroupCustomersPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<SearchParams> }) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      redirect("/login?next=/group-customers");
    redirect("/dashboard");
  }
  const isLead = hasAssignedRole(user, "LEAD");
  const isGroupOperator = hasAssignedRole(user, "GROUP_OPERATOR");
  const isReceptionist = hasAssignedRole(user, "RECEPTION");
  const isManager = user.role === "ADMIN" || user.role === "COMPANY_MANAGER";
  if (!hasAnyRole(user, groupCustomerPageRoles)) redirect("/dashboard");
  const [raw, settings, allGroups] = await Promise.all([
    searchParams,
    getSystemSettings(),
    isManager ? db.teamGroup.findMany({
      select: { id: true, name: true, active: true, departmentId: true, countryCode: true, department: { select: { name: true, countryCode: true, companyId: true } } },
      orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    }) : Promise.resolve([]),
  ]);
  const today = statisticsDate();
  const values = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const leadRange = resolveLeadDateRange(values.range || values.sourceDateFrom || values.sourceDateTo ? values : { ...values, range: "all" }, today);
  const pagination = parsePage(values.page);
  const query = values.q?.trim() ?? "";
  const view: GroupCustomerView = ["inGroup", "introduced", "expertProgress", "ordered", "left"].includes(values.view)
    ? values.view as GroupCustomerView
    : "inGroup";
  const expertStage = (["QUEUED", "MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED", "STALLED"].includes(values.expertStage) ? values.expertStage : "") as GroupCustomerExpertStageFilter;
  const leaveRisk = (["EARLY", "WATCH", "NORMAL", "UNKNOWN"].includes(values.leaveRisk) ? values.leaveRisk : "") as GroupCustomerLeaveRisk;
  const leaveOrder = (["ordered", "not-ordered"].includes(values.leaveOrder) ? values.leaveOrder : "") as GroupCustomerLeaveOrder;
  const sourceDate = leadRange.preset === "all" ? undefined : { gte: leadRange.from, lte: leadRange.to };
  const readableGroups = isManager ? resolveReadableReportGroups(user, allGroups) : [];
  const selectedGroupId = isManager
    ? readableGroups.some((group) => group.id === values.groupId)
      ? values.groupId!
      : ""
    : user.groupId ?? "";
  await autoMarkExpiredGroupMemberships({
    today,
    groupIds: isManager ? (selectedGroupId ? [selectedGroupId] : readableGroups.map((group) => group.id)) : [selectedGroupId],
  });
  const workspace = await loadGroupCustomerWorkspace({
    groupIds: isManager
      ? (selectedGroupId ? [selectedGroupId] : readableGroups.map((group) => group.id))
      : [selectedGroupId],
    userId: user.id,
    isLead,
    isGroupOperator,
    isReceptionist,
    sourceDate,
    query,
    skip: pagination.skip,
    take: pagination.take,
    view,
    member: values.member?.trim() ?? "",
    channel: values.channel?.trim() ?? "",
    expertStage,
    leaveRisk,
    leaveOrder,
  });
  const {
    customers,
    groupOperators,
    expertAssignees,
    totalCustomers,
    filteredTotal,
    viewCounts,
    earlyLeftCount,
    filterOptions,
    performanceSummary,
  } = workspace;
  const contactAccounts = (isLead || isGroupOperator)
    ? await db.deviceAccount.findMany({
      where: { groupId: selectedGroupId, ownerId: user.id },
      select: { id: true, accountNumber: true, accountType: true },
      orderBy: { accountNumber: "asc" },
    })
    : [];
  const expertContactAccounts = (isLead || isGroupOperator)
    ? await db.deviceAccount.findMany({
      where: { groupId: selectedGroupId, ownerId: { in: expertAssignees.map((assignee) => assignee.id) } },
      select: { id: true, ownerId: true, accountNumber: true, accountType: true },
      orderBy: { accountNumber: "asc" },
    })
    : [];
  const historicalMembers = (isLead || isGroupOperator) && selectedGroupId ? await db.user.findMany({
    where: { groupId: selectedGroupId },
    select: { id: true, name: true, active: true, role: true, roleAssignments: { select: { role: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  }) : [];
  const historicalChannels = (isLead || isGroupOperator) && selectedGroupId ? await db.channel.findMany({
    where: { groupId: selectedGroupId, name: { not: "专家历史补录（系统）" } },
    select: { id: true, name: true, active: true, channelType: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  }) : [];
  const summaryByOperator = new Map(
    performanceSummary.map((summary) => [summary.operatorId ?? "__unassigned__", summary]),
  );
  const operatorPerformance: GroupOperatorPerformance[] = groupOperators.map((operator) => {
    const summary = summaryByOperator.get(operator.id);
    return {
      id: operator.id,
      name: operator.name,
      active: operator.active,
      unassigned: false,
      receptionNames: operator.groupOperatorAssignments.map((assignment) => assignment.receptionist.name),
      handled: summary?.handled ?? 0,
      inGroup: summary?.inGroup ?? 0,
      introduced: summary?.introduced ?? 0,
      left: summary?.left ?? 0,
      earlyLeft: summary?.earlyLeft ?? 0,
      watchLeft: summary?.watchLeft ?? 0,
      normalLeft: summary?.normalLeft ?? 0,
      unknownLeft: summary?.unknownLeft ?? 0,
      leftWithOrder: summary?.leftWithOrder ?? 0,
      leftWithoutOrder: summary?.leftWithoutOrder ?? 0,
      pendingIntroduction: summary?.pendingIntroduction ?? 0,
      firstDepositCents: summary?.firstDepositCents ?? 0,
    };
  });
  const unassignedSummary = summaryByOperator.get("__unassigned__");
  if (unassignedSummary && shouldShowUnassignedRow(unassignedSummary)) operatorPerformance.unshift({
    id: "__unassigned__",
    name: "未分配炒群岗",
    active: false,
    unassigned: true,
    receptionNames: unassignedSummary.receptionNames,
    handled: unassignedSummary.handled,
    inGroup: unassignedSummary.inGroup,
    introduced: unassignedSummary.introduced,
    left: unassignedSummary.left,
    earlyLeft: unassignedSummary.earlyLeft,
    watchLeft: unassignedSummary.watchLeft,
    normalLeft: unassignedSummary.normalLeft,
    unknownLeft: unassignedSummary.unknownLeft,
    leftWithOrder: unassignedSummary.leftWithOrder,
    leftWithoutOrder: unassignedSummary.leftWithoutOrder,
    pendingIntroduction: unassignedSummary.pendingIntroduction,
    firstDepositCents: unassignedSummary.firstDepositCents,
  });
  operatorPerformance.sort((left, right) => right.earlyLeft - left.earlyLeft || right.pendingIntroduction - left.pendingIntroduction || Number(right.unassigned) - Number(left.unassigned) || left.name.localeCompare(right.name, "zh-CN"));
  return (
    <main className="page-shell lead-compact-page workflow-wide-page lead-full-bleed-page lead-phase-page space-y-2">
      <div className="page-heading">
        <div>
          <h1 className="page-title">{isLead || isManager ? "炒群明细" : "群内客户"}<span className="ml-2 text-base font-normal text-slate-500">共 {totalCustomers} 人</span></h1>
          <p className="page-description">
            {isManager ? "查看所选小组的在群、已退群、推专家、专家跟进和开单情况；仅查看，不会改动一线记录。" : isLead ? "查看本组全部炒群客户：在群、已退群、推专家、专家跟进和开单情况。" : "分别查看本组在群和已退群客户，核对负责人、来源、跟进进度和资金结果。"}
          </p>
        </div>
      </div>
      {isLead ? <LeadWorkspaceTabs kind="customers" dateRange={leadRange} /> : null}
      {workspace.missingReceptionAssignment && isGroupOperator ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">暂未配置固定配合的前台接粉员；你仍可查看自己已接手的客户和补录历史群客户。新客户需要组长配置协作后才会自动分配。</p> : null}
      <LeadDateRangeFilter pathname="/group-customers" range={leadRange} today={today} allowAll preserve={isManager && selectedGroupId ? { groupId: selectedGroupId } : {}} />
      {isLead ? <GroupOperatorPerformanceTable operators={operatorPerformance} range={{ from: leadRange.from, to: leadRange.to }} query={query} /> : null}
      {isManager ? <form className="phase-scope-filter" method="get">
        {Object.entries(values).filter(([key]) => key !== "groupId" && key !== "page").map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
        <label>筛选小组
          <select name="groupId" aria-label="筛选小组" defaultValue={selectedGroupId ?? ""} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">全部小组</option>
            {readableGroups.map((group) => <option key={group.id} value={group.id}>{group.department.name} / {group.name}</option>)}
          </select>
        </label>
        <button type="submit" className="phase-scope-apply"><Eye size={15} weight="bold" aria-hidden="true" />查看</button>
      </form> : null}
      <GroupCustomerTable
        customers={customers}
        query={query}
        canEdit={isLead || isGroupOperator}
        canAddHistorical={isLead || isGroupOperator}
        historicalImportOptions={{
          members: historicalMembers.map((member) => ({ id: member.id, name: member.name, active: member.active, roleLabel: getAssignedRoles(member).map((role) => role === "RECEPTION" ? "接粉" : role === "GROUP_OPERATOR" ? "炒群" : role === "EXPERT" ? "专家" : role === "LEAD" ? "组长" : role).join("／") || "成员" })),
          channels: historicalChannels,
          currentUserId: user.id,
          entryRole: isLead ? "LEAD" : "GROUP_OPERATOR",
        }}
        currentDate={today}
        assignees={expertAssignees.map((assignee) => ({
          id: assignee.id,
          name: assignee.name,
        role: assignee.role as "LEAD" | "EXPERT",
        pendingRegistration: assignee.expertLeads.filter((lead) => !lead.registeredOn).length,
        pendingOrder: assignee.expertLeads.filter((lead) => lead.registeredOn && (!lead.customerOrder || lead.customerOrder.voidedAt)).length,
        deviceAccounts: expertContactAccounts.filter((account) => account.ownerId === assignee.id).map(({ ownerId: _ownerId, ...account }) => account),
        }))}
        contactAccounts={contactAccounts}
        activeView={view}
        viewCounts={viewCounts}
        earlyLeftCount={earlyLeftCount}
        activeFilters={{ member: values.member ?? "", channel: values.channel ?? "", expertStage, leaveRisk, leaveOrder, stage: values.stage === "LEFT" || values.stage === "IN_GROUP_PENDING_EXPERT" ? values.stage : "" }}
        filterOptions={filterOptions}
      />
      <Pagination pathname="/group-customers" values={{ ...values, view }} page={pagination.page} pageSize={pagination.pageSize} total={filteredTotal} />
    </main>
  );
}
