import type { Position, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { statisticsDate } from "../../../lib/statistics-date";
import { db } from "../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { hasOversizedQueryValue } from "../../../lib/request-limits";
import { getAssignedRoles, hasAssignedRole } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";
import { getSystemSettings } from "../../../lib/settings";
import { usesCustomerNumberTracking } from "../../../lib/customer-number-tracking";

type Role = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
const frontlineRoles = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;

const empty = () => ({
  added: 0, duplicate: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0,
  left: 0, earlyLeft: 0, introduced: 0, contacted: 0, registered: 0, orders: 0,
  noInitialDeposit: 0, stalled: 0, initialDepositCents: 0, rechargeCents: 0,
  withdrawalCents: 0, netCents: 0,
});

type FunnelRow = {
  added: number; duplicate: number; lowAmount: number; noWs: number; effective: number;
  replied: number; joined: number; leftNormal: number; leftAbnormal: number; pushed: number;
  registered: number; ordered: number; depositCents: number; withdrawalCents: number; netCents: number;
};

const emptyFunnel = (): FunnelRow => ({
  added: 0, duplicate: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0,
  leftNormal: 0, leftAbnormal: 0, pushed: 0, registered: 0, ordered: 0,
  depositCents: 0, withdrawalCents: 0, netCents: 0,
});

type PerformanceEntry = Prisma.DailyStatEntryGetPayload<{
  select: {
    id: true; ownerId: true; businessDate: true; position: true; channelId: true;
    sourceReceptionId: true; sourceGroupOperatorId: true;
    channel: { select: { id: true; name: true } };
    approvedRevision: true;
  };
}>;

const rate = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;

function attributionWhere(actorId: string, role: Role): Prisma.DailyStatEntryWhereInput {
  if (role === "RECEPTION") return {
    OR: [
      { ownerId: actorId, position: "RECEPTION" },
      { sourceReceptionId: actorId, position: { in: ["GROUP_OPERATOR", "EXPERT"] } },
    ],
  };
  if (role === "GROUP_OPERATOR") return {
    OR: [
      { ownerId: actorId, position: "GROUP_OPERATOR" },
      { sourceGroupOperatorId: actorId, position: "EXPERT" },
    ],
  };
  return { ownerId: actorId, position: "EXPERT" };
}

function addFunnelEntry(target: FunnelRow, entry: PerformanceEntry, viewerRole: Role) {
  const value = entry.approvedRevision;
  if (!value) return;
  if (entry.position === "RECEPTION") {
    target.added += value.dispatchCount;
    target.duplicate += value.duplicateCount;
    target.lowAmount += value.lowAmountCount;
    target.noWs += value.noWsCount;
    target.effective += value.effectiveCount;
    target.replied += value.replyCount;
    target.joined += value.joinCount;
  } else if (entry.position === "GROUP_OPERATOR") {
    // 接粉自己的“进群”仍以接粉统计为准，不能再把炒群接手数重复加一次。
    // 号码跟踪切换后，接粉人的进群也来自这条自动事件行；炒群人只是代为维护进度。
    if (viewerRole === "GROUP_OPERATOR" || (viewerRole === "RECEPTION" && usesCustomerNumberTracking(entry.businessDate))) {
      target.joined += value.operatorReceivedCount;
    }
    target.leftNormal += value.normalLeaveCount;
    target.leftAbnormal += value.abnormalLeaveCount;
    target.pushed += value.expertIntroCount;
  } else {
    // 专家本人没有炒群行，专家接手数就是其漏斗中“推到专家”这一档的分母。
    if (viewerRole === "EXPERT") target.pushed += value.expertReceivedCount;
    target.registered += value.registrationCount;
    target.ordered += value.orderCount;
    target.depositCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents
      + value.cryptoRechargeCents + value.bankRechargeCents;
    target.withdrawalCents += value.withdrawalCents;
  }
  target.netCents = target.depositCents - target.withdrawalCents;
}

function buildFunnel(entries: PerformanceEntry[], viewerRole: Role) {
  const summary = emptyFunnel();
  const byDate = new Map<string, FunnelRow>();
  const byChannel = new Map<string, { id: string; name: string; row: FunnelRow }>();
  for (const entry of entries) {
    addFunnelEntry(summary, entry, viewerRole);
    const daily = byDate.get(entry.businessDate) ?? emptyFunnel();
    addFunnelEntry(daily, entry, viewerRole);
    byDate.set(entry.businessDate, daily);
    const channel = byChannel.get(entry.channelId) ?? { id: entry.channel.id, name: entry.channel.name, row: emptyFunnel() };
    addFunnelEntry(channel.row, entry, viewerRole);
    byChannel.set(entry.channelId, channel);
  }
  return {
    summary,
    daily: [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, row]) => ({ date, row })),
    channels: [...byChannel.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
  };
}

function latestCurrentInGroup(entries: PerformanceEntry[]) {
  const latestByLine = new Map<string, { date: string; count: number }>();
  for (const entry of entries) {
    if (entry.position !== "GROUP_OPERATOR" || !entry.approvedRevision) continue;
    const key = `${entry.ownerId}:${entry.sourceReceptionId ?? ""}:${entry.channelId}`;
    const current = latestByLine.get(key);
    if (!current || entry.businessDate > current.date) {
      latestByLine.set(key, { date: entry.businessDate, count: entry.approvedRevision.currentInGroupCount });
    } else if (entry.businessDate === current.date) {
      current.count += entry.approvedRevision.currentInGroupCount;
    }
  }
  return [...latestByLine.values()].reduce((sum, item) => sum + item.count, 0);
}

export async function GET(request: Request) {
  let actor;
  try { actor = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 }); throw error; }
  if (!actor.active || !actor.groupId || !getAssignedRoles(actor).some((role) => frontlineRoles.includes(role as Role)))
    return authorizationDenied(actor, "当前账号没有一线个人业绩权限");
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const requestedRole = params.get("role") as Role | null;
  const role = requestedRole && frontlineRoles.includes(requestedRole) ? requestedRole
    : frontlineRoles.find((candidate) => hasAssignedRole(actor, candidate)) ?? null;
  if (!role || !hasAssignedRole(actor, role)) return authorizationDenied(actor, "当前账号没有所选岗位权限");

  const settings = await getSystemSettings();
  const timezone = await resolveUserBusinessTimezone(actor, settings.timezone);
  const today = statisticsDate();
  const range = resolveDateRangeWithDefault(Object.fromEntries(params), today, "month");
  const scope = attributionWhere(actor.id, role);
  const select = {
    id: true, ownerId: true, businessDate: true, position: true, channelId: true,
    sourceReceptionId: true, sourceGroupOperatorId: true,
    channel: { select: { id: true, name: true } }, approvedRevision: true,
  } as const;
  const [entries, snapshotEntries] = await Promise.all([
    db.dailyStatEntry.findMany({
      where: { groupId: actor.groupId, approvedRevisionId: { not: null }, businessDate: { gte: range.from, lte: range.to }, AND: [scope] },
      select,
    }),
    role === "EXPERT" ? Promise.resolve([] as PerformanceEntry[]) : db.dailyStatEntry.findMany({
      where: {
        groupId: actor.groupId, position: "GROUP_OPERATOR", approvedRevisionId: { not: null },
        businessDate: { lte: range.to },
        ...(role === "RECEPTION" ? { sourceReceptionId: actor.id } : { ownerId: actor.id }),
      },
      select,
    }),
  ]);

  // 岗位主数据仍只算本人填写的对应岗位，保证排行榜和岗位成绩永不串账。
  const ownEntries = entries.filter((entry) => entry.ownerId === actor.id && entry.position === role);
  const totals = empty();
  let expertReceived = 0;
  for (const entry of ownEntries) {
    const value = entry.approvedRevision;
    if (!value) continue;
    totals.added += value.dispatchCount;
    totals.duplicate += value.duplicateCount;
    totals.lowAmount += value.lowAmountCount;
    totals.noWs += value.noWsCount;
    totals.effective += value.effectiveCount;
    totals.replied += value.replyCount;
    totals.joined += role === "GROUP_OPERATOR" ? value.operatorReceivedCount : value.joinCount;
    totals.left += value.normalLeaveCount + value.abnormalLeaveCount;
    totals.earlyLeft += value.abnormalLeaveCount;
    totals.introduced += value.expertIntroCount;
    expertReceived += value.expertReceivedCount;
    totals.contacted += value.expertContactedCount;
    totals.registered += value.registrationCount;
    totals.orders += value.orderCount;
    totals.initialDepositCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents;
    totals.rechargeCents += value.cryptoRechargeCents + value.bankRechargeCents;
    totals.withdrawalCents += value.withdrawalCents;
  }
  totals.netCents = totals.initialDepositCents + totals.rechargeCents - totals.withdrawalCents;
  const funnel = buildFunnel(entries, role);
  const currentInGroup = latestCurrentInGroup(snapshotEntries);
  return NextResponse.json({
    role, today, timezone, range, totals, currentInGroup,
    funnel: { ...funnel, currentInGroup },
    rates: {
      reply: rate(totals.replied, totals.effective), join: rate(totals.joined, totals.effective),
      introduced: rate(totals.introduced, totals.joined), contacted: rate(totals.contacted, expertReceived),
      registered: rate(totals.registered, totals.contacted), ordered: rate(totals.orders, totals.registered),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
