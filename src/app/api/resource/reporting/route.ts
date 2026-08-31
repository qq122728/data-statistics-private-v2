import { NextResponse } from "next/server";

import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { sumLatestCurrentInGroup } from "../../../../lib/daily-stat-snapshots";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";
import { dailyStatAttributionOwnerId } from "../../../../lib/daily-stat-attribution";

const ranges = new Set(["today", "yesterday", "7d", "30d", "month", "lastMonth", "custom"]);

export async function GET(request: Request) {
  let actor;
  try { actor = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !hasAssignedRole(actor, "RESOURCE_MANAGER"))
    return authorizationDenied(actor, "只有在职资源部管理员可以查看渠道数据");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const allowedChannelIds = actor.resourceChannelAccess?.map((item) => item.channelId) ?? [];
  if (!allowedChannelIds.length) return NextResponse.json({ rows: [], channels: [], groups: [] }, { headers: { "Cache-Control": "private, no-store" } });

  const channels = await db.channel.findMany({
    where: { id: { in: allowedChannelIds }, active: true, group: { active: true } },
    select: {
      id: true, name: true, normalizedName: true,
      group: {
        select: {
          id: true, name: true, groupType: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true,
          department: { select: { id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, company: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: [{ group: { name: "asc" } }, { name: "asc" }],
  });

  const requestedRange = params.get("range") ?? "month";
  const preset = ranges.has(requestedRange) ? requestedRange : "month";
  const channelPeriods = channels.map((channel) => {
    const timezone = resolveGroupBusinessTime(channel.group).timezone;
    const today = localDateYYYYMMDD(new Date(), timezone);
    const range = resolveDateRangeWithDefault({
      range: preset,
      sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
      sourceDateTo: params.get("sourceDateTo") ?? undefined,
    }, today, "month");
    return { channel, timezone, today, range };
  });
  const minimumFrom = channelPeriods.map((item) => item.range.from).sort()[0];
  const maximumTo = channelPeriods.map((item) => item.range.to).sort().at(-1);
  const entries = minimumFrom && maximumTo ? await db.dailyStatEntry.findMany({
    where: {
      channelId: { in: channels.map((channel) => channel.id) },
      approvedRevisionId: { not: null },
      businessDate: { gte: minimumFrom, lte: maximumTo },
    },
    select: {
      groupId: true,
      channelId: true,
      ownerId: true,
      owner: { select: { id: true, name: true, role: true } },
      sourceReceptionId: true,
      sourceReception: { select: { id: true, name: true, role: true } },
      businessDate: true,
      position: true,
      approvedRevision: true,
    },
  }) : [];
  const snapshotEntries = maximumTo ? await db.dailyStatEntry.findMany({
    where: {
      channelId: { in: channels.map((channel) => channel.id) },
      position: "GROUP_OPERATOR",
      approvedRevisionId: { not: null },
      businessDate: { lte: maximumTo },
    },
    select: {
      groupId: true, channelId: true, ownerId: true, sourceReceptionId: true,
      owner: { select: { id: true, name: true, role: true } },
      sourceReception: { select: { id: true, name: true, role: true } },
      businessDate: true, position: true, approvedRevision: true,
    },
  }) : [];

  function aggregate(scoped: typeof entries, snapshots: typeof snapshotEntries = scoped) {
    const totals = scoped.reduce((sum, entry) => {
      const revision = entry.approvedRevision!;
      sum.added += revision.dispatchCount;
      sum.collision += revision.duplicateCount;
      sum.lowAmount += revision.lowAmountCount;
      sum.noWs += revision.noWsCount;
      sum.manualInvalid += revision.manualInvalidCount;
      sum.lawyerRealCase += revision.lawyerRealCaseCount;
      sum.lawyerAdded += revision.lawyerAddedCount;
      sum.lawyerExpertAdded += revision.lawyerExpertAddedCount;
      sum.customerServicePush += revision.customerServicePushCount;
      sum.effective += revision.effectiveCount;
      sum.replied += revision.replyCount;
      sum.joined += revision.joinCount;
      sum.left += revision.normalLeaveCount + revision.abnormalLeaveCount;
      sum.abnormalLeft += revision.abnormalLeaveCount;
      sum.pushed += revision.expertIntroCount;
      sum.registered += revision.registrationCount;
      sum.ordered += revision.orderCount;
      sum.initialDepositCents += revision.cryptoInitialDepositCents + revision.bankInitialDepositCents;
      sum.rechargeCents += revision.cryptoRechargeCents + revision.bankRechargeCents;
      sum.cryptoDepositCents += revision.cryptoInitialDepositCents + revision.cryptoRechargeCents;
      sum.bankDepositCents += revision.bankInitialDepositCents + revision.bankRechargeCents;
      sum.depositCents += revision.cryptoInitialDepositCents + revision.bankInitialDepositCents + revision.cryptoRechargeCents + revision.bankRechargeCents;
      sum.withdrawalCents += revision.withdrawalCents;
      return sum;
    }, {
      added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0, effective: 0, replied: 0, joined: 0,
      left: 0, abnormalLeft: 0, pushed: 0, registered: 0, ordered: 0, depositCents: 0,
      initialDepositCents: 0, rechargeCents: 0, cryptoDepositCents: 0, bankDepositCents: 0, withdrawalCents: 0,
    });
    return { ...totals, inGroup: sumLatestCurrentInGroup(snapshots) };
  }

  const rows = channelPeriods.map(({ channel, timezone, today, range }) => {
    const scoped = entries.filter((entry) => entry.channelId === channel.id && entry.groupId === channel.group.id
      && entry.businessDate >= range.from && entry.businessDate <= range.to && entry.approvedRevision);
    const snapshots = snapshotEntries.filter((entry) => entry.channelId === channel.id
      && entry.groupId === channel.group.id && entry.businessDate <= range.to);
    return {
      channel: { id: channel.id, name: channel.name, normalizedName: channel.normalizedName },
      group: { id: channel.group.id, name: channel.group.name, groupType: channel.group.groupType, departmentId: channel.group.department.id, departmentName: channel.group.department.name, companyId: channel.group.department.company?.id ?? null, companyName: channel.group.department.company?.name ?? "未归属公司" },
      period: { preset: range.preset, from: range.from, to: range.to, today, timezone },
      totals: aggregate(scoped, snapshots),
    };
  });
  const days = [...new Set(entries.map((entry) => entry.businessDate))].sort().reverse().map((date) => ({
    date,
    rows: channelPeriods.flatMap(({ channel, timezone, today, range }) => {
      if (date < range.from || date > range.to) return [];
      const scoped = entries.filter((entry) => entry.businessDate === date && entry.channelId === channel.id
        && entry.groupId === channel.group.id && entry.approvedRevision);
      if (!scoped.length) return [];
      return [{
        channel: { id: channel.id, name: channel.name, normalizedName: channel.normalizedName },
        group: { id: channel.group.id, name: channel.group.name, groupType: channel.group.groupType, departmentName: channel.group.department.name },
        period: { preset: range.preset, from: date, to: date, today, timezone },
        totals: aggregate(scoped),
      }];
    }),
  })).filter((day) => day.rows.length > 0);

  const groupIds = [...new Set(channels.map((channel) => channel.group.id))];
  const members = groupIds.length ? await db.user.findMany({
    where: { active: true, groupId: { in: groupIds }, role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
    select: { id: true, name: true, role: true, groupId: true },
    orderBy: [{ groupId: "asc" }, { name: "asc" }],
  }) : [];
  const memberBuckets = new Map<string, { date: string; channelId: string; groupId: string; member: { id: string; name: string; role: string }; totals: ReturnType<typeof aggregate> }>();
  for (const entry of entries) {
    if (!entry.approvedRevision) continue;
    const attributionOwner = entry.sourceReception ?? entry.owner;
    const attributionOwnerId = dailyStatAttributionOwnerId(entry);
    const key = `${entry.businessDate}\u0000${entry.channelId}\u0000${entry.groupId}\u0000${attributionOwnerId}`;
    const current = memberBuckets.get(key);
    const totals = aggregate([entry], []);
    if (current) {
      for (const metric of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[metric] += current.totals[metric];
      }
    }
    memberBuckets.set(key, {
      date: entry.businessDate,
      channelId: entry.channelId,
      groupId: entry.groupId,
      member: { id: attributionOwner.id, name: attributionOwner.name, role: attributionOwner.role },
      totals,
    });
  }
  // “当前在群”是存量，不是当天新增量。某位归属组员当天没有新填写，
  // 仍要把此前最近一次快照带到当天，否则个人合计会比小组合计少。
  const datesByScope = new Map<string, Set<string>>();
  for (const entry of entries) {
    const scopeKey = `${entry.channelId}\u0000${entry.groupId}`;
    const dates = datesByScope.get(scopeKey) ?? new Set<string>();
    dates.add(entry.businessDate);
    datesByScope.set(scopeKey, dates);
  }
  const snapshotOwners = new Map<string, { channelId: string; groupId: string; member: { id: string; name: string; role: string }; firstDate: string }>();
  for (const entry of snapshotEntries) {
    const member = entry.sourceReception ?? entry.owner;
    const key = `${entry.channelId}\u0000${entry.groupId}\u0000${member.id}`;
    const existing = snapshotOwners.get(key);
    if (!existing || entry.businessDate < existing.firstDate)
      snapshotOwners.set(key, { channelId: entry.channelId, groupId: entry.groupId, member, firstDate: entry.businessDate });
  }
  for (const owner of snapshotOwners.values()) {
    const dates = datesByScope.get(`${owner.channelId}\u0000${owner.groupId}`) ?? [];
    for (const date of dates) {
      if (date < owner.firstDate) continue;
      const key = `${date}\u0000${owner.channelId}\u0000${owner.groupId}\u0000${owner.member.id}`;
      if (!memberBuckets.has(key)) memberBuckets.set(key, {
        date,
        channelId: owner.channelId,
        groupId: owner.groupId,
        member: owner.member,
        totals: aggregate([], []),
      });
    }
  }
  // 员工行里的“当前在群”同样是业务线快照。先聚合同日流量，再按员工、渠道、
  // 小组和截止日重新取各来源业务线最新值，避免同日多来源漏算、跨日重复累加。
  for (const bucket of memberBuckets.values()) {
    bucket.totals.inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) =>
      dailyStatAttributionOwnerId(entry) === bucket.member.id
      && entry.channelId === bucket.channelId
      && entry.groupId === bucket.groupId
      && entry.businessDate <= bucket.date));
  }

  return NextResponse.json({
    rows,
    days,
    members,
    memberRows: [...memberBuckets.values()].sort((left, right) =>
      right.date.localeCompare(left.date)
      || left.groupId.localeCompare(right.groupId)
      || left.channelId.localeCompare(right.channelId)
      || left.member.name.localeCompare(right.member.name, "zh-CN")),
    channels: [...new Map(rows.map((row) => [row.channel.id, row.channel])).values()],
    groups: [...new Map(rows.map((row) => [row.group.id, row.group])).values()],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
