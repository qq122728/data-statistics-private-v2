import { redirect } from "next/navigation";
import {
  ExpertCustomerTable,
  type ExpertCustomer,
} from "../../../components/lead/ExpertCustomerTable";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { ExpertPerformanceTable, type ExpertPerformance } from "../../../components/lead/ExpertPerformanceTable";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { statisticsDate } from "../../../lib/statistics-date";
import { resolveLeadDateRange } from "../../../lib/lead-date-range";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { parsePage } from "../../../lib/pagination";
import { Pagination } from "../../../components/ui/Pagination";
import { loadExpertCustomerWorkspace } from "../../../lib/customer-queries/expert-customers";
import { expertCustomerPageRoles, getAssignedRoles, hasAnyRole, hasAssignedRole } from "../../../lib/role-access";
import { db } from "../../../lib/db";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { Eye } from "@phosphor-icons/react/dist/ssr";
import { autoMarkExpiredGroupMemberships } from "../../../lib/group-lifecycle";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * 未分配专家这一行不能只看 handled——pendingRegistration/pendingOrder 这两个字段
 * 没有跟 handled 一样的历史补录口径判断，一个客户完全可能 handled 记成0、但仍然
 * 挂着待注册/待开单的真实待办，只看 handled 会把这行连带真实待办一起藏起来。
 */
export function shouldShowUnassignedExpertRow(summary: { handled: number; registered: number; ordered: number; pendingRegistration: number; pendingOrder: number }): boolean {
  return Boolean(summary.handled || summary.registered || summary.ordered || summary.pendingRegistration || summary.pendingOrder);
}

export default async function ExpertCustomersPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<SearchParams> }) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      redirect("/login?next=/expert-customers");
    redirect("/dashboard");
  }
  // 账号可兼任多个岗位；不能只看主岗位，否则兼任专家／组长会进入页面却没有对应操作权限。
  const isLead = hasAssignedRole(user, "LEAD");
  const isExpert = hasAssignedRole(user, "EXPERT");
  const isManager = user.role === "ADMIN" || user.role === "COMPANY_MANAGER";
  if (!hasAnyRole(user, expertCustomerPageRoles)) redirect("/dashboard");
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
  const {
    customers,
    assignees,
    expertMembers,
    totalCustomers,
    performanceSummary,
  } = await loadExpertCustomerWorkspace({
    groupIds: isManager
      ? (selectedGroupId ? [selectedGroupId] : readableGroups.map((group) => group.id))
      : [selectedGroupId],
    userId: user.id,
    isLead,
    isExpert,
    sourceDate,
    query,
    skip: pagination.skip,
    take: pagination.take,
  });
  const summaryByExpert = new Map(
    performanceSummary.map((summary) => [summary.expertOwnerId ?? "__unassigned__", summary]),
  );
  const expertPerformance: ExpertPerformance[] = expertMembers
    .filter((member) => member.role === "EXPERT" || summaryByExpert.has(member.id))
    .map((member) => {
      const summary = summaryByExpert.get(member.id);
      return {
        id: member.id,
        name: member.name,
        active: member.active,
        proxyLead: member.role === "LEAD",
        unassigned: false,
        handled: summary?.handled ?? 0,
        registered: summary?.registered ?? 0,
        ordered: summary?.ordered ?? 0,
        depositCents: summary?.depositCents ?? 0,
        cryptoDepositCents: summary?.cryptoDepositCents ?? 0,
        bankDepositCents: summary?.bankDepositCents ?? 0,
        unclassifiedDepositCents: summary?.unclassifiedDepositCents ?? 0,
        pendingRegistration: summary?.pendingRegistration ?? 0,
        pendingOrder: summary?.pendingOrder ?? 0,
      };
    });
  const unassignedSummary = summaryByExpert.get("__unassigned__");
  if (unassignedSummary && shouldShowUnassignedExpertRow(unassignedSummary)) expertPerformance.unshift({
    id: "__unassigned__",
    name: "未分配专家",
    active: false,
    proxyLead: false,
    unassigned: true,
    handled: unassignedSummary.handled,
    registered: unassignedSummary.registered,
    ordered: unassignedSummary.ordered,
    depositCents: unassignedSummary.depositCents,
    cryptoDepositCents: unassignedSummary.cryptoDepositCents,
    bankDepositCents: unassignedSummary.bankDepositCents,
    unclassifiedDepositCents: unassignedSummary.unclassifiedDepositCents,
    pendingRegistration: unassignedSummary.pendingRegistration,
    pendingOrder: unassignedSummary.pendingOrder,
  });
  expertPerformance.sort((left, right) => Number(right.unassigned) - Number(left.unassigned) || (right.pendingRegistration + right.pendingOrder) - (left.pendingRegistration + left.pendingOrder) || left.name.localeCompare(right.name, "zh-CN"));
  const contactAccounts = (isLead || isExpert)
    ? await db.deviceAccount.findMany({
      where: { groupId: selectedGroupId, ownerId: user.id },
      select: { id: true, accountNumber: true, accountType: true },
      orderBy: { accountNumber: "asc" },
    })
    : [];
  const historicalMembers = (isLead || isExpert) && selectedGroupId
    ? await db.user.findMany({
      // 历史补录按当时实际归属复原：不能只列出当前在职、当前岗位的人。
      // 例如今天是专家的人，过去也可能负责过接粉／炒群。
      where: { groupId: selectedGroupId },
      select: { id: true, name: true, role: true, active: true, roleAssignments: { select: { role: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    })
    : [];
  const historicalOwnerOptions = historicalMembers.map((member) => ({
    id: member.id,
    name: member.name,
    active: member.active,
    roleLabel: getAssignedRoles(member).map((role) => role === "RECEPTION" ? "接粉" : role === "GROUP_OPERATOR" ? "炒群" : role === "EXPERT" ? "专家" : role === "LEAD" ? "组长" : role).join("／") || "成员",
  }));
  const historicalSourceChannels = (isLead || isExpert) && selectedGroupId
    ? await db.channel.findMany({
      where: { groupId: selectedGroupId, name: { not: "专家历史补录（系统）" } },
      select: { id: true, name: true, active: true, channelType: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    })
    : [];

  return (
    <main className="page-shell lead-compact-page workflow-wide-page lead-full-bleed-page lead-phase-page space-y-2">
      <div className="page-heading">
        <div>
          <h1 className="page-title">{isLead || isManager ? "专家管理" : "专家客户情况"}<span className="ml-2 text-base font-normal text-slate-500">共 {totalCustomers} 人</span></h1>
          <p className="page-description">
            {isManager ? "查看炒群推送后的专家全流程：排队、交资料、追踪、注册、开单和资金情况；仅查看，不会改动一线记录。" : isLead ? "查看本组客户从推专家进入排队后的完整专家流程；专家负责接待、资料、追踪、注册、开单和后续资金。" : "炒群推专家后客户会直接进入排队中；由专家开始接待、确认交资料并在 48 小时内完成追踪。"}
          </p>
        </div>
      </div>
      {isLead ? <LeadWorkspaceTabs kind="customers" dateRange={leadRange} /> : null}
      <LeadDateRangeFilter pathname="/expert-customers" range={leadRange} today={today} allowAll preserve={isManager && selectedGroupId ? { groupId: selectedGroupId } : {}} />
      {isLead ? <ExpertPerformanceTable experts={expertPerformance} range={{ from: leadRange.from, to: leadRange.to }} query={query} /> : null}
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
      <ExpertCustomerTable
        customers={customers}
        today={today}
        query={query}
        canEdit={isLead || isExpert}
        canAssign={isLead}
        canAddHistorical={isLead || isExpert}
        historicalImportOptions={{
          members: historicalOwnerOptions,
          channels: historicalSourceChannels,
          currentUserId: user.id,
          entryRole: isLead ? "LEAD" : "EXPERT",
        }}
        assignees={assignees.map((assignee) => ({
          id: assignee.id,
          name: assignee.name,
          label: assignee.role === "LEAD" ? `${assignee.name}（组长代专家）` : assignee.name,
        }))}
        contactAccounts={contactAccounts}
      />
      <Pagination pathname="/expert-customers" values={values} page={pagination.page} pageSize={pagination.pageSize} total={totalCustomers} />
    </main>
  );
}
