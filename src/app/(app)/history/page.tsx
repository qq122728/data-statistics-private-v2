import { redirect } from "next/navigation";
import { EventHistoryTable, type HistoryBatch } from "../../../components/history/EventHistoryTable";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { normalizeChannelName } from "../../../lib/channel-names";
import { db } from "../../../lib/db";
import { LeadWorkspaceTabs } from "../../../components/lead/LeadWorkspaceTabs";
import { groupHistoryEvents, synchronizeHistoryLeadCounts, type HistoryGroupEvent } from "../../../lib/history-groups";
import { parseAnalysisFilters } from "../../../lib/analytics/scope";
import { AnalysisFilterNotice } from "../../../components/analytics/AnalysisState";
import { CustomerOrderHistory } from "../../../components/history/CustomerOrderHistory";
import { ReceptionPerformanceTable, type ReceptionMemberPerformance } from "../../../components/lead/ReceptionPerformanceTable";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { resolveLeadDateRange } from "../../../lib/lead-date-range";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function HistoryPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<SearchParams> }) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/history");
    throw error;
  }
  if (user.role === "GROUP_OPERATOR") redirect("/group-customers");
  if (user.role === "EXPERT") redirect("/expert-customers");
  if (user.role === "RESOURCE_MANAGER" || user.role === "COMPANY_MANAGER" || user.role === "FINANCE") redirect("/team-performance");
  if (user.role === "HR") redirect("/personnel");

  const raw = await searchParams;
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const settings = await getSystemSettings();
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const leadRange = resolveLeadDateRange(user.role === "LEAD" && !rawValues.range && !rawValues.sourceDateFrom && !rawValues.sourceDateTo ? { ...rawValues, range: "all" } : rawValues, today);
  const parsedFilters = parseAnalysisFilters(new URLSearchParams(rawValues));
  const filters = user.role === "LEAD" ? { ...parsedFilters, sourceDateFrom: leadRange.from, sourceDateTo: leadRange.to } : parsedFilters;
  const groupId = user.role === "ADMIN" ? filters.groupId : user.role === "LEAD" ? user.groupId ?? "" : undefined;
  const memberId = user.role === "RECEPTION"
    ? filters.memberId && filters.memberId !== user.id ? "__forbidden_member__" : user.id
    : filters.memberId;
  const sourceDate = filters.sourceDateFrom || filters.sourceDateTo
    ? { ...(filters.sourceDateFrom ? { gte: filters.sourceDateFrom } : {}), ...(filters.sourceDateTo ? { lte: filters.sourceDateTo } : {}) }
    : undefined;
  const normalizedName = filters.normalizedName ? normalizeChannelName(filters.normalizedName) : undefined;
  const eventScope = {
    ...(memberId ? { enteredById: memberId } : {}),
    batch: {
      ...(groupId ? { groupId } : {}),
      ...(sourceDate ? { sourceDate } : {}),
      ...(normalizedName ? { channel: { normalizedName } } : {}),
    },
  };
  const batchScope = user.role === "ADMIN" ? {} : { groupId: user.groupId ?? "" };
  const [visibleEvents, batches, customerOrders, leads, receptionMembers] = await Promise.all([
    db.metricEvent.findMany({
      where: { ...eventScope, customerOrderId: null, voidedAt: null },
      select: {
        id: true,
        occurredOn: true,
        kind: true,
        quantity: true,
        amountCents: true,
        derivedFromLedger: true,
        createdAt: true,
        batch: {
          select: {
            id: true,
            sourceDate: true,
            group: { select: { id: true, name: true, active: true } },
            channel: { select: { id: true, name: true, normalizedName: true, active: true } },
          },
        },
        enteredBy: { select: { id: true, name: true, active: true } },
      },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
    }),
    db.sourceBatch.findMany({
      where: { ...batchScope, group: { active: true }, channel: { active: true } },
      select: {
        id: true,
        sourceDate: true,
        group: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true } },
      },
      orderBy: [{ sourceDate: "desc" }, { channelId: "asc" }],
    }),
    db.customerOrder.findMany({
      where: { ...eventScope, voidedAt: null },
      select: {
        id: true, phone: true, openedOn: true, initialDepositCents: true,
        enteredBy: { select: { name: true } },
        batch: { select: { sourceDate: true, channel: { select: { name: true } }, group: { select: { name: true } } } },
        events: { where: { kind: { in: ["RECHARGE", "WITHDRAWAL"] }, voidedAt: null }, select: { kind: true, amountCents: true, occurredOn: true, continuationNumber: true }, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ openedOn: "desc" }, { createdAt: "desc" }],
    }),
    db.leadCustomer.findMany({
      where: {
        ...(memberId ? { ownerId: memberId } : {}),
        batch: {
          ...(groupId ? { groupId } : {}),
          ...(sourceDate ? { sourceDate } : {}),
          ...(normalizedName ? { channel: { normalizedName } } : {}),
        },
      },
      select: {
        id: true,
        phone: true,
        customerName: true,
        ownerId: true,
        batchId: true,
        invalid: true,
        replyStatus: true,
        joinedOn: true,
        followUpCount: true,
        lastFollowedUpOn: true,
        owner: { select: { id: true, name: true, active: true } },
        device: { select: { code: true } },
        batch: { select: { sourceDate: true, channel: { select: { name: true } } } },
      },
    }),
    user.role === "LEAD"
      ? db.user.findMany({
          where: { groupId: user.groupId ?? "", role: "RECEPTION", ...(memberId ? { id: memberId } : {}) },
          select: { id: true, name: true, active: true },
          orderBy: [{ active: "desc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
  ]);
  const groups = synchronizeHistoryLeadCounts(groupHistoryEvents(visibleEvents satisfies HistoryGroupEvent[]), leads);
  const receptionMemberMap = new Map(receptionMembers.map((member) => [member.id, member]));
  for (const lead of leads) receptionMemberMap.set(lead.owner.id, lead.owner);
  const receptionPerformance: ReceptionMemberPerformance[] = [...receptionMemberMap.values()].map((member) => {
    const owned = leads.filter((lead) => lead.ownerId === member.id);
    const valid = owned.filter((lead) => !lead.invalid);
    const replied = valid.filter((lead) => lead.replyStatus === "REPLIED");
    const joined = valid.filter((lead) => lead.joinedOn !== null);
    return {
      id: member.id,
      name: member.name,
      active: member.active,
      total: owned.length,
      invalid: owned.length - valid.length,
      valid: valid.length,
      replied: replied.length,
      joined: joined.length,
      pendingReply: valid.filter((lead) => lead.replyStatus !== "REPLIED").length,
      pendingJoin: replied.filter((lead) => lead.joinedOn === null).length,
    };
  }).sort((left, right) => (right.pendingReply + right.pendingJoin) - (left.pendingReply + left.pendingJoin) || Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, "zh-CN"));

  return <main className={user.role === "LEAD" ? "page-shell lead-compact-page workflow-wide-page lead-full-bleed-page lead-phase-page space-y-2" : "page-shell space-y-4"}>
    <div className="page-heading">
      <div>
        <h1 className="page-title">{user.role === "LEAD" ? "接粉明细" : "客户记录"}</h1>
        <p className="page-description">{user.role === "LEAD" ? "查看本组接粉人员的添加、有效、回复、进群和待跟进数量。" : "提交号码、无效粉和有效粉按实际手机号实时计算；开单与资金按手机号单独追溯。"}</p>
      </div>
    </div>
    {user.role === "LEAD" ? <><LeadWorkspaceTabs kind="customers" dateRange={leadRange} /><LeadDateRangeFilter pathname="/history" range={leadRange} today={today} allowAll /></> : null}
    <AnalysisFilterNotice message={filters.filterWarning} />
    {user.role === "LEAD" ? <ReceptionPerformanceTable members={receptionPerformance} /> : <><CustomerOrderHistory orders={customerOrders} /><EventHistoryTable groups={groups} batches={batches satisfies HistoryBatch[]} currentUser={{ id: user.id, role: user.role }} initialFilters={filters} /></>}
  </main>;
}
