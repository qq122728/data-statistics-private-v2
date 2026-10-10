import { buildGroupBusinessPeriods } from "./analytics/group-business-periods";
import { resolveGroupBusinessTime } from "./business-time";
import { sumLatestCurrentInGroup } from "./daily-stat-snapshots";
import { db } from "./db";
import { addBatchTotals, calculateAbnormalLeaveRate, calculateConversionRates, emptyBatchTotals, type BatchTotals } from "./metrics";
import { dailyStatAttributionOwner, dailyStatAttributionOwnerId } from "./daily-stat-attribution";
import { revisionForNumberTracking } from "./customer-number-tracking";
import { countCurrentInGroup, type CurrentInGroupCustomer } from "./current-in-group-customers";

import { isNumberReportDate as usesCustomerNumberTracking, loadManagementSheetStock, sumSavedHistoricalStock, NUMBER_REPORT_FROM } from "./management-report-stock";

import type { Prisma } from "@prisma/client";
import type { LeadDateRange } from "./lead-date-range";
export const organizationReportGroupSelect = {
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
      members: {
        where: { active: true, duty: "LEAD" },
        select: { id: true, name: true },
        take: 1,
      },
    } as const;

type ReportGroup = Prisma.TeamGroupGetPayload<{select: typeof organizationReportGroupSelect}>;
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


/** Trusted server-side loader. Callers must resolve permitted groups before calling. */
export async function loadOrganizationReport(selectedGroups: ReportGroup[], range: LeadDateRange, now = new Date(), client: Pick<typeof db, "dailyStatEntry" | "user" | "channel" | "customerSheetRow"> = db, options: { includeDailyDetails?: boolean } = {}) {
  const periods = buildGroupBusinessPeriods(selectedGroups, now, range);

  const groupIds = selectedGroups.map((group) => group.id);
  const minimumFrom = Object.values(periods).map((period) => period.from).sort()[0] ?? range.from;
  const maximumTo = Object.values(periods).map((period) => period.to).sort().at(-1) ?? range.to;
  const sumReportStock = maximumTo < NUMBER_REPORT_FROM ? sumSavedHistoricalStock : sumLatestCurrentInGroup;
  const [dailyEntries, snapshotEntries, activeUsers, currentInGroupCustomers] = groupIds.length ? await Promise.all([
    client.dailyStatEntry.findMany({
      where: { groupId: { in: groupIds }, currentRevisionId: { not: null }, businessDate: { gte: minimumFrom, lte: maximumTo } },
      select: {
        id: true, groupId: true, channelId: true, sourceReceptionId: true, sourceMode: true,
        businessDate: true, position: true, ownerId: true,
        owner: { select: { id: true, name: true, active: true } },
        sourceReception: { select: { id: true, name: true, active: true } },
        channel: { select: { id: true, name: true, normalizedName: true, channelType: true } },
        currentRevision: true,
        approvedRevision: true,
      },
    }),
    client.dailyStatEntry.findMany({
      where: {
        groupId: { in: groupIds },
        position: { in: ["RECEPTION", "GROUP_OPERATOR"] },
        currentRevisionId: { not: null },
        businessDate: { lte: maximumTo },
      },
      select: {
        groupId: true, channelId: true, ownerId: true, sourceReceptionId: true,
        businessDate: true, position: true, currentRevision: true, approvedRevision: true,
        channel: { select: { id: true, name: true, normalizedName: true } },
      },
    }),
    client.user.findMany({
      where: {
        groupId: { in: groupIds }, active: true,
        OR: [
          { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
          { roleAssignments: { some: { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } } } },
        ],
      },
      select: { id: true, name: true, active: true, groupId: true },
    }),
    loadManagementSheetStock(selectedGroups.filter(g=>g.groupType==="HACKER").map(g=>g.id), maximumTo, client),
  ]) : [[], [], [], []];
  const entries = dailyEntries.filter((entry) => {
    const period = periods[entry.groupId];
    if (selectedGroups.find(g=>g.id===entry.groupId)?.groupType === "HACKER" && entry.businessDate >= NUMBER_REPORT_FROM && entry.sourceMode !== "NUMBER") return false;
    return Boolean((entry.currentRevision ?? entry.approvedRevision) && period && entry.businessDate >= period.from && entry.businessDate <= period.to);
  });

  type Aggregate = { totals: BatchTotals; contacted: number; lowAmount: number; noWs: number; manualInvalid: number; lawyerRealCase: number; lawyerAdded: number; lawyerExpertAdded: number; customerServicePush: number; initialDepositCents: number; rechargeOnlyCents: number; cryptoDepositCents: number; bankDepositCents: number; latestSnapshotDate: string; inGroup: number };
  const freshAggregate = (): Aggregate => ({ totals: emptyBatchTotals(), contacted: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0, initialDepositCents: 0, rechargeOnlyCents: 0, cryptoDepositCents: 0, bankDepositCents: 0, latestSnapshotDate: "", inGroup: 0 });
  const groupAggregates = new Map<string, Aggregate>();
  const groupTypeById = new Map(selectedGroups.map((group) => [group.id, group.groupType]));
  const memberAggregates = new Map<string, Aggregate>();
  const dailyGroupAggregates = new Map<string, Aggregate>();
  const dailyMemberAggregates = new Map<string, Aggregate>();
  const dailyDetailAggregates = new Map<string, {
    date: string;
    groupId: string;
    member: { id: string; name: string };
    channel: { id: string; name: string };
    aggregate: Aggregate;
  }>();
  const channelAggregates = new Map<string, { name: string; aggregate: Aggregate; groupIds: Set<string> }>();
  const groupChannelAggregates = new Map<string, { groupId: string; name: string; normalizedName: string; aggregate: Aggregate }>();
  const sourceTypeAggregates = new Map<string, Aggregate>();
  const metadataByGroup = new Map(selectedGroups.map((group) => [group.id, group]));
  function applyRevision(aggregate: Aggregate, entry: (typeof entries)[number], revision: ApprovedDailyRevision) {
    revision = revisionForNumberTracking(revision, {
      businessDate: entry.businessDate,
      position: entry.position,
      groupType: groupTypeById.get(entry.groupId) ?? "HACKER",
      sourceMode: entry.sourceMode,
    });
    addBatchTotals(aggregate.totals, revisionTotals(revision));
    aggregate.contacted += revision.expertContactedCount;
    // Number-based entries already include joinCount; do not add operator receipts again.
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
    const attributionOwner = dailyStatAttributionOwner(entry);
    const memberKey = `${entry.groupId}:${attributionOwnerId}`;
    const memberAggregate = memberAggregates.get(memberKey) ?? freshAggregate();
    const dailyGroupKey = `${entry.businessDate}:${entry.groupId}`;
    const dailyMemberKey = `${entry.businessDate}:${memberKey}`;
    const dailyGroupAggregate = dailyGroupAggregates.get(dailyGroupKey) ?? freshAggregate();
    const dailyMemberAggregate = dailyMemberAggregates.get(dailyMemberKey) ?? freshAggregate();
    const normalizedChannelName = entry.channel.normalizedName || entry.channel.name;
    const aggregates = [groupAggregate, memberAggregate, dailyGroupAggregate, dailyMemberAggregate];
    if (options.includeDailyDetails) {
      const dailyDetailKey = `${entry.businessDate}\0${entry.groupId}\0${attributionOwnerId}\0${normalizedChannelName}`;
      const dailyDetailRow = dailyDetailAggregates.get(dailyDetailKey) ?? {
        date: entry.businessDate,
        groupId: entry.groupId,
        member: { id: attributionOwner.id, name: attributionOwner.name },
        channel: { id: entry.channel.id, name: entry.channel.name },
        aggregate: freshAggregate(),
      };
      aggregates.push(dailyDetailRow.aggregate);
      dailyDetailAggregates.set(dailyDetailKey, dailyDetailRow);
    }
    for (const aggregate of aggregates) applyRevision(aggregate, entry, revision);
    const sourceTypeAggregate = sourceTypeAggregates.get(entry.channel.channelType) ?? freshAggregate();
    applyRevision(sourceTypeAggregate, entry, revision);
    sourceTypeAggregates.set(entry.channel.channelType, sourceTypeAggregate);
    const channelGroupType = groupTypeById.get(entry.groupId) ?? "HACKER";
    const channelKey = `${channelGroupType}:${normalizedChannelName}`;
    const channelRow = channelAggregates.get(channelKey) ?? { name: entry.channel.name, aggregate: freshAggregate(), groupIds: new Set<string>() };
    applyRevision(channelRow.aggregate, entry, revision);
    channelRow.groupIds.add(entry.groupId);
    channelAggregates.set(channelKey, channelRow);
    const groupChannelKey = `${entry.groupId}\0${normalizedChannelName}`;
    const groupChannelRow = groupChannelAggregates.get(groupChannelKey) ?? { groupId: entry.groupId, name: entry.channel.name, normalizedName: normalizedChannelName, aggregate: freshAggregate() };
    applyRevision(groupChannelRow.aggregate, entry, revision);
    groupChannelAggregates.set(groupChannelKey, groupChannelRow);
    groupAggregates.set(entry.groupId, groupAggregate);
    memberAggregates.set(memberKey, memberAggregate);
    dailyGroupAggregates.set(dailyGroupKey, dailyGroupAggregate);
    dailyMemberAggregates.set(dailyMemberKey, dailyMemberAggregate);
  }
  for (const customer of currentInGroupCustomers) {
    const metadata = metadataByGroup.get(customer.groupId);
    if (!metadata || metadata.groupType !== "HACKER" || !usesCustomerNumberTracking(periods[customer.groupId]?.to ?? "")) continue;
    const normalizedName = customer.channel.normalizedName || customer.channel.name;
    const channelKey = `${metadata.groupType}:${normalizedName}`;
    const channelRow = channelAggregates.get(channelKey) ?? { name: customer.channel.name, aggregate: freshAggregate(), groupIds: new Set<string>() };
    channelRow.groupIds.add(customer.groupId);
    channelAggregates.set(channelKey, channelRow);
    const groupChannelKey = `${customer.groupId}\0${normalizedName}`;
    if (!groupChannelAggregates.has(groupChannelKey)) groupChannelAggregates.set(groupChannelKey, {
      groupId: customer.groupId, name: customer.channel.name, normalizedName, aggregate: freshAggregate(),
    });
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
        pushed: totals.expertIntro, contacted: aggregate.contacted, registered: totals.registration, ordered: totals.orders,
        initialDepositCents: aggregate.initialDepositCents, rechargeCents: aggregate.rechargeOnlyCents,
        depositCents: totals.rechargeCents, withdrawalCents: totals.withdrawalCents, netCents: totals.rechargeCents - totals.withdrawalCents,
        cryptoDepositCents: aggregate.cryptoDepositCents, bankDepositCents: aggregate.bankDepositCents,
      },
      rates: {
        ...calculateConversionRates(totals),
        abnormalLeaveRate: calculateAbnormalLeaveRate(totals),
        lawyerReplyRate: totals.newFans ? totals.replies / totals.newFans : null,
        lawyerAddedRate: totals.newFans ? aggregate.lawyerAdded / totals.newFans : null,
        lawyerExpertAddedRate: totals.newFans ? aggregate.lawyerExpertAdded / totals.newFans : null,
      },
    };
  }

  const groups = selectedGroups.map((metadata) => {
    const period = periods[metadata.id];
    const aggregate = groupAggregates.get(metadata.id) ?? freshAggregate();
    const inGroup = metadata.groupType === "HACKER" && usesCustomerNumberTracking(period.to)
      ? countCurrentInGroup(currentInGroupCustomers, (customer) => customer.groupId === metadata.id)
      : sumReportStock(snapshotEntries.filter((entry) =>
          entry.groupId === metadata.id && entry.businessDate <= period.to));
    return {
      id: metadata.id,
      name: metadata.name,
      groupType: metadata.groupType,
      leadName: metadata.members[0]?.name ?? null,
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
  for (const customer of currentInGroupCustomers) {
    memberPeople.set(`${customer.groupId}:${customer.member.id}`, { ...customer.member, active: true, groupId: customer.groupId });
  }
  const members = [...memberPeople.entries()].map(([key, person]) => {
    const aggregate = memberAggregates.get(key) ?? freshAggregate();
    const metadata = metadataByGroup.get(person.groupId!);
    const period = periods[person.groupId!];
    const inGroup = metadata?.groupType === "HACKER" && Boolean(period) && usesCustomerNumberTracking(period.to)
      ? countCurrentInGroup(currentInGroupCustomers, (customer) => customer.groupId === person.groupId && customer.member.id === person.id)
      : sumReportStock(snapshotEntries.filter((entry) =>
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

  const dailyDetails = [...dailyDetailAggregates.values()].map((row) => {
    const metadata = metadataByGroup.get(row.groupId)!;
    return {
      date: row.date,
      groupId: row.groupId,
      groupName: metadata.name,
      groupType: metadata.groupType,
      department: { id: metadata.department.id, name: metadata.department.name },
      company: metadata.department.company,
      member: row.member,
      channel: row.channel,
      ...serializeAggregate(row.aggregate),
    };
  }).sort((left, right) =>
    right.date.localeCompare(left.date)
    || `${left.company?.name ?? ""}-${left.department.name}-${left.groupName}-${left.member.name}-${left.channel.name}`
      .localeCompare(`${right.company?.name ?? ""}-${right.department.name}-${right.groupName}-${right.member.name}-${right.channel.name}`, "zh-CN"));

  const channels = [...channelAggregates.entries()].map(([typedKey, row]) => {
    const [groupType, ...nameParts] = typedKey.split(":");
    const normalizedName = nameParts.join(":");
    const inGroup = groupType === "HACKER" && usesCustomerNumberTracking(maximumTo)
      ? countCurrentInGroup(currentInGroupCustomers, (customer) => {
          const metadata = metadataByGroup.get(customer.groupId);
          return metadata?.groupType === groupType
            && (customer.channel.normalizedName || customer.channel.name) === normalizedName;
        })
      : sumReportStock(snapshotEntries.filter((entry) => {
      const metadata = metadataByGroup.get(entry.groupId);
      const period = metadata ? periods[metadata.id] : null;
      return groupTypeById.get(entry.groupId) === groupType
        && (entry.channel.normalizedName || entry.channel.name) === normalizedName
        && Boolean(period) && entry.businessDate <= period!.to;
    }));
    return { id: typedKey, name: row.name, groupType, groupCount: row.groupIds.size, ...serializeAggregate(row.aggregate, inGroup) };
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  const groupChannels = [...groupChannelAggregates.entries()].map(([key, row]) => {
    const metadata = metadataByGroup.get(row.groupId)!;
    const period = periods[row.groupId];
    const inGroup = metadata.groupType === "HACKER" && usesCustomerNumberTracking(period.to)
      ? countCurrentInGroup(currentInGroupCustomers, (customer) => customer.groupId === row.groupId
          && (customer.channel.normalizedName || customer.channel.name) === row.normalizedName)
      : sumReportStock(snapshotEntries.filter((entry) =>
          entry.groupId === row.groupId
          && (entry.channel.normalizedName || entry.channel.name) === row.normalizedName
          && Boolean(period) && entry.businessDate <= period.to));
    return {
      id: key,
      groupId: row.groupId,
      groupName: metadata.name,
      groupType: metadata.groupType,
      activePeople: activeUsers.filter((person) => person.groupId === row.groupId).length,
      department: { id: metadata.department.id, name: metadata.department.name },
      company: metadata.department.company,
      channel: { name: row.name },
      ...serializeAggregate(row.aggregate, inGroup),
    };
  }).sort((left, right) => `${left.company?.name ?? ""}-${left.department.name}-${left.groupName}-${left.channel.name}`.localeCompare(`${right.company?.name ?? ""}-${right.department.name}-${right.groupName}-${right.channel.name}`, "zh-CN"));

  const sourceTypes = ["SMS", "ADS", "REBATE"].map(channelType => ({channelType, ...serializeAggregate(sourceTypeAggregates.get(channelType) ?? freshAggregate())}));
  return {
    range: { preset: range.preset, label: range.label, from: range.from, to: range.to },
    groups, groupChannels, members, channels, days, sourceTypes,
    ...(options.includeDailyDetails ? { dailyDetails } : {}),
  };
}
