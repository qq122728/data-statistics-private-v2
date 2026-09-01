import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireUser } from "../../../../lib/auth";
import { buildGroupBusinessPeriods } from "../../../../lib/analytics/group-business-periods";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { statisticsDate } from "../../../../lib/statistics-date";
import { sumLatestCurrentInGroup } from "../../../../lib/daily-stat-snapshots";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { addBatchTotals, calculateConversionRates, emptyBatchTotals, type BatchTotals } from "../../../../lib/metrics";
import { hasAssignedRole } from "../../../../lib/role-access";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied, authorizationErrorResponse } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";
import { managedDepartmentIds } from "../../../../lib/managed-department-scope";
import { dailyStatAttributionOwner, dailyStatAttributionOwnerId } from "../../../../lib/daily-stat-attribution";
import { revisionForNumberTracking, usesCustomerNumberTracking } from "../../../../lib/customer-number-tracking";

const allowedRanges = new Set(["all", "today", "yesterday", "7d", "week", "30d", "month", "lastMonth", "custom"]);

type ApprovedDailyRevision = {
  dispatchCount: number; duplicateCount: number; lowAmountCount: number; noWsCount: number; effectiveCount: number;
  manualInvalidCount: number;
  lawyerRealCaseCount: number; lawyerAddedCount: number; lawyerExpertAddedCount: number; customerServicePushCount: number;
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
 * 2) 只汇总已经生效的 DailyStatEntry；客户进度动作不参与统计；
 * 3) “今日/近7天/当月”统一按北京时间 14:00 换日后的统计日期计算。
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
        ? { active: true, departmentId: { in: managedDepartmentIds(actor) }, department: { active: true } }
        : { active: true, id: actor.groupId ?? "__missing_group__" };

  const accessibleGroups = await db.teamGroup.findMany({
    where: groupWhere,
    select: {
      id: true,
      name: true,
      groupType: true,
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
  const fallbackToday = statisticsDate(now);
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
  const [dailyEntries, snapshotEntries, activeUsers] = groupIds.length ? await Promise.all([
    db.dailyStatEntry.findMany({
      where: { groupId: { in: groupIds }, currentRevisionId: { not: null }, businessDate: { gte: minimumFrom, lte: maximumTo } },
      select: {
        id: true, groupId: true, channelId: true, sourceReceptionId: true,
        businessDate: true, position: true, ownerId: true,
        owner: { select: { id: true, name: true, active: true } },
        sourceReception: { select: { id: true, name: true, active: true } },
        channel: { select: { id: true, name: true, normalizedName: true } },
        currentRevision: true,
        approvedRevision: true,
      },
    }),
    db.dailyStatEntry.findMany({
      where: {
        groupId: { in: groupIds },
        position: "GROUP_OPERATOR",
        currentRevisionId: { not: null },
        businessDate: { lte: maximumTo },
      },
      select: {
        groupId: true, channelId: true, ownerId: true, sourceReceptionId: true,
        businessDate: true, position: true, currentRevision: true, approvedRevision: true,
        channel: { select: { id: true, name: true, normalizedName: true } },
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
  ]) : [[], [], []];
  const entries = dailyEntries.filter((entry) => {
    const period = periods[entry.groupId];
    return Boolean((entry.currentRevision ?? entry.approvedRevision) && period && entry.businessDate >= period.from && entry.businessDate <= period.to);
  });

  type Aggregate = { totals: BatchTotals; lowAmount: number; noWs: number; manualInvalid: number; lawyerRealCase: number; lawyerAdded: number; lawyerExpertAdded: number; customerServicePush: number; initialDepositCents: number; rechargeOnlyCents: number; cryptoDepositCents: number; bankDepositCents: number; latestSnapshotDate: string; inGroup: number };
  const freshAggregate = (): Aggregate => ({ totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, manualInvalid: 0, lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0, initialDepositCents: 0, rechargeOnlyCents: 0, cryptoDepositCents: 0, bankDepositCents: 0, latestSnapshotDate: "", inGroup: 0 });
  const groupAggregates = new Map<string, Aggregate>();
  const groupTypeById = new Map(selectedGroups.map((group) => [group.id, group.groupType]));
  const memberAggregates = new Map<string, Aggregate>();
  const dailyGroupAggregates = new Map<string, Aggregate>();
  const dailyMemberAggregates = new Map<string, Aggregate>();
  const channelAggregates = new Map<string, { name: string; aggregate: Aggregate; groupIds: Set<string> }>();
  function applyRevision(aggregate: Aggregate, entry: (typeof entries)[number], revision: ApprovedDailyRevision) {
    const numberTrackedOperator = groupTypeById.get(entry.groupId) === "HACKER"
      && entry.position === "GROUP_OPERATOR"
      && usesCustomerNumberTracking(entry.businessDate);
    revision = revisionForNumberTracking(revision, {
      businessDate: entry.businessDate,
      position: entry.position,
      groupType: groupTypeById.get(entry.groupId) ?? "HACKER",
    });
    addBatchTotals(aggregate.totals, revisionTotals(revision));
    if (numberTrackedOperator) aggregate.totals.groupJoin += revision.operatorReceivedCount;
    aggregate.lowAmount += revision.lowAmountCount;
    aggregate.noWs += revision.noWsCount;
    aggregate.manualInvalid += revision.manualInvalidCount ?? 0;
    aggregate.lawyerRealCase += revision.lawyerRealCaseCount ?? 0;
    aggregate.lawyerAdded += revision.lawyerAddedCount ?? 0;
    aggregate.lawyerExpertAdded += revision.lawyerExpertAddedCount ?? 0;
    aggregate.customerServicePush += revision.customerServicePushCount ?? 0;
    aggregate.initialDepositCents += revision.cryptoInitialDepositCents + revision.bankInitialDepositCents;
    aggregate.rechargeOnlyCents += revision.cryptoRechargeCents + revision.bankRechargeCents;
    aggregate.cryptoDepositCents += revision.cryptoInitialDepositCents + revision.cryptoRechargeCents;
    aggregate.bankDepositCents += revision.bankInitialDepositCents + revision.bankRechargeCents;
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
    const revision = (entry.currentRevision ?? entry.approvedRevision) as ApprovedDailyRevision;
    const groupAggregate = groupAggregates.get(entry.groupId) ?? freshAggregate();
    const attributionOwnerId = dailyStatAttributionOwnerId(entry);
    const memberKey = `${entry.groupId}:${attributionOwnerId}`;
    const memberAggregate = memberAggregates.get(memberKey) ?? freshAggregate();
    const dailyGroupKey = `${entry.businessDate}:${entry.groupId}`;
    const dailyMemberKey = `${entry.businessDate}:${memberKey}`;
    const dailyGroupAggregate = dailyGroupAggregates.get(dailyGroupKey) ?? freshAggregate();
    const dailyMemberAggregate = dailyMemberAggregates.get(dailyMemberKey) ?? freshAggregate();
    for (const aggregate of [groupAggregate, memberAggregate, dailyGroupAggregate, dailyMemberAggregate]) applyRevision(aggregate, entry, revision);
    const normalizedChannelName = entry.channel.normalizedName || entry.channel.name;
    const channelGroupType = groupTypeById.get(entry.groupId) ?? "HACKER";
    const channelKey = `${channelGroupType}:${normalizedChannelName}`;
    const channelRow = channelAggregates.get(channelKey) ?? { name: entry.channel.name, aggregate: freshAggregate(), groupIds: new Set<string>() };
    applyRevision(channelRow.aggregate, entry, revision);
    channelRow.groupIds.add(entry.groupId);
    channelAggregates.set(channelKey, channelRow);
    groupAggregates.set(entry.groupId, groupAggregate);
    memberAggregates.set(memberKey, memberAggregate);
    dailyGroupAggregates.set(dailyGroupKey, dailyGroupAggregate);
    dailyMemberAggregates.set(dailyMemberKey, dailyMemberAggregate);
  }

  function serializeAggregate(aggregate: Aggregate, inGroup = aggregate.inGroup) {
    const totals = aggregate.totals;
    const abnormalLeave = totals.abnormalGroupLeave ?? 0;
    return {
      totals: {
        added: totals.newFans, collision: totals.duplicateFans, lowAmount: aggregate.lowAmount, noWs: aggregate.noWs, manualInvalid: aggregate.manualInvalid,
        lawyerRealCase: aggregate.lawyerRealCase, lawyerAdded: aggregate.lawyerAdded, lawyerExpertAdded: aggregate.lawyerExpertAdded, customerServicePush: aggregate.customerServicePush,
        effective: totals.effectiveFans, replied: totals.replies, joined: totals.groupJoin,
        leftNormal: Math.max(0, totals.groupLeave - abnormalLeave), leftAbnormal: abnormalLeave, inGroup,
        pushed: totals.expertIntro, registered: totals.registration, ordered: totals.orders,
        initialDepositCents: aggregate.initialDepositCents, rechargeCents: aggregate.rechargeOnlyCents,
        depositCents: totals.rechargeCents, withdrawalCents: totals.withdrawalCents, netCents: totals.rechargeCents - totals.withdrawalCents,
        cryptoDepositCents: aggregate.cryptoDepositCents, bankDepositCents: aggregate.bankDepositCents,
      },
      rates: {
        ...calculateConversionRates(totals),
        abnormalLeaveRate: Math.max(0, totals.groupJoin - (totals.groupLeave - abnormalLeave)) > 0
          ? abnormalLeave / Math.max(1, totals.groupJoin - (totals.groupLeave - abnormalLeave))
          : null,
        lawyerReplyRate: totals.newFans ? totals.replies / totals.newFans : null,
        lawyerAddedRate: totals.newFans ? aggregate.lawyerAdded / totals.newFans : null,
        lawyerExpertAddedRate: totals.newFans ? aggregate.lawyerExpertAdded / totals.newFans : null,
      },
    };
  }

  const metadataByGroup = new Map(selectedGroups.map((group) => [group.id, group]));
  const groups = selectedGroups.map((metadata) => {
    const period = periods[metadata.id];
    const aggregate = groupAggregates.get(metadata.id) ?? freshAggregate();
    const inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) =>
      entry.groupId === metadata.id && entry.businessDate <= period.to));
    return {
      id: metadata.id,
      name: metadata.name,
      groupType: metadata.groupType,
      department: { id: metadata.department.id, name: metadata.department.name },
      company: metadata.department.company,
      timezone: resolveGroupBusinessTime(metadata).timezone,
      period,
      activePeople: activeUsers.filter((person) => person.groupId === metadata.id).length,
      ...serializeAggregate(aggregate, inGroup),
    };
  });

  const memberPeople = new Map(activeUsers.map((person) => [`${person.groupId}:${person.id}`, person]));
  for (const entry of entries) {
    const attributionOwner = dailyStatAttributionOwner(entry);
    memberPeople.set(`${entry.groupId}:${attributionOwner.id}`, { ...attributionOwner, groupId: entry.groupId });
  }
  const members = [...memberPeople.entries()].map(([key, person]) => {
    const aggregate = memberAggregates.get(key) ?? freshAggregate();
    const metadata = metadataByGroup.get(person.groupId!);
    const period = periods[person.groupId!];
    const inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) =>
      entry.groupId === person.groupId && dailyStatAttributionOwnerId(entry) === person.id
      && Boolean(period) && entry.businessDate <= period.to));
    return ({
    id: person.id,
    name: person.name,
    groupId: person.groupId!,
    groupName: metadata?.name ?? "未知小组",
    groupType: metadata?.groupType ?? "HACKER",
    active: person.active,
    ...serializeAggregate(aggregate, inGroup),
  }); });

  const days = [...new Set(entries.map((entry) => entry.businessDate))].sort().reverse().map((date) => ({
    date,
    groups: selectedGroups.map((group) => ({ groupId: group.id, groupType: group.groupType, ...serializeAggregate(dailyGroupAggregates.get(`${date}:${group.id}`) ?? freshAggregate()) })),
    members: [...memberPeople.entries()].map(([key, person]) => ({
      id: person.id,
      name: person.name,
      groupId: person.groupId!,
      ...serializeAggregate(dailyMemberAggregates.get(`${date}:${key}`) ?? freshAggregate()),
    })),
  }));

  const channels = [...channelAggregates.entries()].map(([typedKey, row]) => {
    const [groupType, ...nameParts] = typedKey.split(":");
    const normalizedName = nameParts.join(":");
    const inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) => {
      const metadata = metadataByGroup.get(entry.groupId);
      const period = metadata ? periods[metadata.id] : null;
      return groupTypeById.get(entry.groupId) === groupType
        && (entry.channel.normalizedName || entry.channel.name) === normalizedName
        && Boolean(period) && entry.businessDate <= period!.to;
    }));
    return { id: typedKey, name: row.name, groupType, groupCount: row.groupIds.size, ...serializeAggregate(row.aggregate, inGroup) };
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return NextResponse.json({ range: { preset: range.preset, label: range.label }, groups, members, channels, days }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
