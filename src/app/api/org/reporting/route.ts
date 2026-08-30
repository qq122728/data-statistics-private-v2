import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireUser } from "../../../../lib/auth";
import { buildGroupBusinessPeriods } from "../../../../lib/analytics/group-business-periods";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { addBatchTotals, calculateConversionRates, emptyBatchTotals, type BatchTotals } from "../../../../lib/metrics";
import { hasAssignedRole } from "../../../../lib/role-access";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied, authorizationErrorResponse } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";

const allowedRanges = new Set(["all", "today", "yesterday", "7d", "30d", "month", "lastMonth", "custom"]);

type ApprovedDailyRevision = {
  dispatchCount: number; duplicateCount: number; lowAmountCount: number; noWsCount: number; effectiveCount: number;
  replyCount: number; joinCount: number; operatorReceivedCount: number; normalLeaveCount: number;
  abnormalLeaveCount: number; currentInGroupCount: number; expertIntroCount: number; expertReceivedCount: number;
  expertContactedCount: number; registrationCount: number; orderCount: number; cryptoInitialDepositCents: number;
  bankInitialDepositCents: number; cryptoRechargeCents: number; bankRechargeCents: number; withdrawalCents: number;
};

function revisionTotals(value: ApprovedDailyRevision): BatchTotals {
  return {
    ...emptyBatchTotals(),
    newFans: value.dispatchCount,
    duplicateFans: value.duplicateCount,
    effectiveFans: value.effectiveCount,
    noNumber: value.noWsCount,
    replies: value.replyCount,
    groupJoin: value.joinCount,
    groupLeave: value.normalLeaveCount + value.abnormalLeaveCount,
    abnormalGroupLeave: value.abnormalLeaveCount,
    expertIntro: value.expertIntroCount,
    registration: value.registrationCount,
    orders: value.orderCount,
    rechargeCents: value.cryptoInitialDepositCents + value.bankInitialDepositCents + value.cryptoRechargeCents + value.bankRechargeCents,
    withdrawalCents: value.withdrawalCents,
  };
}

/**
 * 新版管理端共用的真实统计入口。它只负责三件事：
 * 1) 按当前账号的 Duty/组长身份解出允许查看的小组；
 * 2) 只汇总组长已经审核通过的 DailyStatEntry；客户进度动作不参与统计；
 * 3) 把同一个“今日/近7天/当月”按每个小组自己的当地日期换算。
 *
 * 返回的小组汇总和成员明细来自同一次查询，所以不会再出现“上层有假汇总、点进去没明细”。
 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof AuthorizationError)
      return authorizationErrorResponse(error, error.message);
    throw error;
  }

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });

  const isLead = hasAssignedRole(actor, "LEAD");
  const canRead = actor.role === "ADMIN" || isLead || actor.duty === "DEPARTMENT_MANAGER" || actor.duty === "COMPANY_MANAGER" || actor.duty === "HQ_MANAGER";
  if (!canRead) return authorizationDenied(actor, "该账号不能查看组织业绩");

  const groupWhere = actor.role === "ADMIN" || actor.duty === "HQ_MANAGER"
    ? { active: true }
    : actor.duty === "COMPANY_MANAGER"
      ? { active: true, department: { active: true, companyId: actor.companyId ?? "__missing_company__" } }
      : actor.duty === "DEPARTMENT_MANAGER"
        ? { active: true, departmentId: actor.departmentId ?? "__missing_department__", department: { active: true } }
        : { active: true, id: actor.groupId ?? "__missing_group__" };

  const accessibleGroups = await db.teamGroup.findMany({
    where: groupWhere,
    select: {
      id: true,
      name: true,
      active: true,
      countryCode: true,
      timezone: true,
      workStartMinutes: true,
      workEndMinutes: true,
      departmentId: true,
      department: {
        select: {
          id: true,
          name: true,
          countryCode: true,
          timezone: true,
          workStartMinutes: true,
          workEndMinutes: true,
          companyId: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
  });

  const requestedGroupId = params.get("groupId") ?? "";
  if (requestedGroupId && !accessibleGroups.some((group) => group.id === requestedGroupId))
    return authorizationDenied(actor, "没有权限查看这个小组");
  const selectedGroups = requestedGroupId
    ? accessibleGroups.filter((group) => group.id === requestedGroupId)
    : accessibleGroups;

  const now = new Date();
  const settings = await getSystemSettings();
  const fallbackToday = localDateYYYYMMDD(now, settings.timezone);
  const rawRange = params.get("range") ?? undefined;
  const range = resolveDateRangeWithDefault({
    range: rawRange && allowedRanges.has(rawRange) ? rawRange : undefined,
    sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
    sourceDateTo: params.get("sourceDateTo") ?? undefined,
  }, fallbackToday, "month");
  const periods = buildGroupBusinessPeriods(selectedGroups, now, range);

  const groupIds = selectedGroups.map((group) => group.id);
  const minimumFrom = Object.values(periods).map((period) => period.from).sort()[0] ?? range.from;
  const maximumTo = Object.values(periods).map((period) => period.to).sort().at(-1) ?? range.to;
  const [dailyEntries, activeUsers] = groupIds.length ? await Promise.all([
    db.dailyStatEntry.findMany({
      where: { groupId: { in: groupIds }, approvedRevisionId: { not: null }, businessDate: { gte: minimumFrom, lte: maximumTo } },
      select: {
        id: true, groupId: true, businessDate: true, position: true, ownerId: true,
        owner: { select: { id: true, name: true, active: true } },
        approvedRevision: true,
      },
    }),
    db.user.findMany({
      where: {
        groupId: { in: groupIds }, active: true,
        OR: [
          { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
          { roleAssignments: { some: { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } } } },
        ],
      },
      select: { id: true, name: true, active: true, groupId: true },
    }),
  ]) : [[], []];
  const entries = dailyEntries.filter((entry) => {
    const period = periods[entry.groupId];
    return Boolean(entry.approvedRevision && period && entry.businessDate >= period.from && entry.businessDate <= period.to);
  });

  type Aggregate = { totals: BatchTotals; lowAmount: number; noWs: number; latestSnapshotDate: string; inGroup: number };
  const freshAggregate = (): Aggregate => ({ totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, latestSnapshotDate: "", inGroup: 0 });
  const groupAggregates = new Map<string, Aggregate>();
  const memberAggregates = new Map<string, Aggregate>();
  const dailyGroupAggregates = new Map<string, Aggregate>();
  const dailyMemberAggregates = new Map<string, Aggregate>();
  function applyRevision(aggregate: Aggregate, entry: (typeof entries)[number], revision: ApprovedDailyRevision) {
    addBatchTotals(aggregate.totals, revisionTotals(revision));
    aggregate.lowAmount += revision.lowAmountCount;
    aggregate.noWs += revision.noWsCount;
    if (entry.position === "GROUP_OPERATOR") {
      if (entry.businessDate > aggregate.latestSnapshotDate) {
        aggregate.latestSnapshotDate = entry.businessDate;
        aggregate.inGroup = revision.currentInGroupCount;
      } else if (entry.businessDate === aggregate.latestSnapshotDate) {
        aggregate.inGroup += revision.currentInGroupCount;
      }
    }
  }
  for (const entry of entries) {
    const revision = entry.approvedRevision as ApprovedDailyRevision;
    const groupAggregate = groupAggregates.get(entry.groupId) ?? freshAggregate();
    const memberKey = `${entry.groupId}:${entry.ownerId}`;
    const memberAggregate = memberAggregates.get(memberKey) ?? freshAggregate();
    const dailyGroupKey = `${entry.businessDate}:${entry.groupId}`;
    const dailyMemberKey = `${entry.businessDate}:${memberKey}`;
    const dailyGroupAggregate = dailyGroupAggregates.get(dailyGroupKey) ?? freshAggregate();
    const dailyMemberAggregate = dailyMemberAggregates.get(dailyMemberKey) ?? freshAggregate();
    for (const aggregate of [groupAggregate, memberAggregate, dailyGroupAggregate, dailyMemberAggregate]) applyRevision(aggregate, entry, revision);
    groupAggregates.set(entry.groupId, groupAggregate);
    memberAggregates.set(memberKey, memberAggregate);
    dailyGroupAggregates.set(dailyGroupKey, dailyGroupAggregate);
    dailyMemberAggregates.set(dailyMemberKey, dailyMemberAggregate);
  }

  function serializeAggregate(aggregate: Aggregate) {
    const totals = aggregate.totals;
    const abnormalLeave = totals.abnormalGroupLeave ?? 0;
    return {
      totals: {
        added: totals.newFans, collision: totals.duplicateFans, lowAmount: aggregate.lowAmount, noWs: aggregate.noWs,
        effective: totals.effectiveFans, replied: totals.replies, joined: totals.groupJoin,
        leftNormal: Math.max(0, totals.groupLeave - abnormalLeave), leftAbnormal: abnormalLeave, inGroup: aggregate.inGroup,
        pushed: totals.expertIntro, registered: totals.registration, ordered: totals.orders,
        depositCents: totals.rechargeCents, withdrawalCents: totals.withdrawalCents, netCents: totals.rechargeCents - totals.withdrawalCents,
      },
      rates: calculateConversionRates(totals),
    };
  }

  const metadataByGroup = new Map(selectedGroups.map((group) => [group.id, group]));
  const groups = selectedGroups.map((metadata) => {
    const period = periods[metadata.id];
    const aggregate = groupAggregates.get(metadata.id) ?? freshAggregate();
    return {
      id: metadata.id,
      name: metadata.name,
      department: { id: metadata.department.id, name: metadata.department.name },
      company: metadata.department.company,
      timezone: resolveGroupBusinessTime(metadata).timezone,
      period,
      activePeople: activeUsers.filter((person) => person.groupId === metadata.id).length,
      ...serializeAggregate(aggregate),
    };
  });

  const memberPeople = new Map(activeUsers.map((person) => [`${person.groupId}:${person.id}`, person]));
  for (const entry of entries) memberPeople.set(`${entry.groupId}:${entry.ownerId}`, { ...entry.owner, groupId: entry.groupId });
  const members = [...memberPeople.entries()].map(([key, person]) => {
    const aggregate = memberAggregates.get(key) ?? freshAggregate();
    const metadata = metadataByGroup.get(person.groupId!);
    return ({
    id: person.id,
    name: person.name,
    groupId: person.groupId!,
    groupName: metadata?.name ?? "未知小组",
    active: person.active,
    ...serializeAggregate(aggregate),
  }); });

  const days = [...new Set(entries.map((entry) => entry.businessDate))].sort().reverse().map((date) => ({
    date,
    groups: selectedGroups.map((group) => ({ groupId: group.id, ...serializeAggregate(dailyGroupAggregates.get(`${date}:${group.id}`) ?? freshAggregate()) })),
    members: [...memberPeople.entries()].map(([key, person]) => ({
      id: person.id,
      name: person.name,
      groupId: person.groupId!,
      ...serializeAggregate(dailyMemberAggregates.get(`${date}:${key}`) ?? freshAggregate()),
    })),
  }));

  return NextResponse.json({ range: { preset: range.preset, label: range.label }, groups, members, days }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
