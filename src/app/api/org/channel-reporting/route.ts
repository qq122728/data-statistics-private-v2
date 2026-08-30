import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireUser } from "../../../../lib/auth";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { sumLatestCurrentInGroup } from "../../../../lib/daily-stat-snapshots";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { calculateConversionRates, emptyBatchTotals } from "../../../../lib/metrics";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied, authorizationErrorResponse } from "../../../../lib/security-events";

const allowedRanges = new Set(["all", "today", "yesterday", "7d", "30d", "month", "lastMonth", "custom"]);

/** 组织管理员在权限范围内查看某个小组的真实渠道拆分；只读，不提供发送审核。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof AuthorizationError) return authorizationErrorResponse(error, error.message);
    throw error;
  }
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const groupId = params.get("groupId") ?? "";
  if (!groupId) return NextResponse.json({ error: "请选择具体小组" }, { status: 400 });
  const canReadOrganization = actor.active && (actor.role === "ADMIN" || actor.duty === "HQ_MANAGER" || actor.duty === "COMPANY_MANAGER" || actor.duty === "DEPARTMENT_MANAGER");
  if (!canReadOrganization) return authorizationDenied(actor, "该账号不能查看组织渠道数据");

  const group = await db.teamGroup.findFirst({
    where: { id: groupId, active: true },
    select: {
      id: true, name: true, departmentId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true,
      department: { select: { companyId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
  });
  if (!group) return NextResponse.json({ error: "小组不存在" }, { status: 404 });
  const inScope = actor.role === "ADMIN" || actor.duty === "HQ_MANAGER"
    || (actor.duty === "COMPANY_MANAGER" && Boolean(actor.companyId) && actor.companyId === group.department.companyId)
    || (actor.duty === "DEPARTMENT_MANAGER" && Boolean(actor.departmentId) && actor.departmentId === group.departmentId);
  if (!inScope) return authorizationDenied(actor, "没有权限查看这个小组的渠道数据");

  const timezone = resolveGroupBusinessTime(group).timezone;
  const today = localDateYYYYMMDD(new Date(), timezone);
  const rawRange = params.get("range") ?? undefined;
  const range = resolveDateRangeWithDefault({
    range: rawRange && allowedRanges.has(rawRange) ? rawRange : undefined,
    sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
    sourceDateTo: params.get("sourceDateTo") ?? undefined,
  }, today, "month");
  const [entries, snapshotEntries] = await Promise.all([
    db.dailyStatEntry.findMany({
      where: { groupId, businessDate: { gte: range.from, lte: range.to }, approvedRevisionId: { not: null } },
      select: {
        groupId: true, channelId: true, ownerId: true, sourceReceptionId: true,
        businessDate: true, position: true,
        owner: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true, normalizedName: true } },
        approvedRevision: true,
      },
    }),
    db.dailyStatEntry.findMany({
      where: {
        groupId, position: "GROUP_OPERATOR",
        businessDate: { lte: range.to }, approvedRevisionId: { not: null },
      },
      select: {
        groupId: true, channelId: true, ownerId: true, sourceReceptionId: true,
        businessDate: true, position: true,
        owner: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true, normalizedName: true } },
        approvedRevision: true,
      },
    }),
  ]);
  type Row = { channel: (typeof entries)[number]["channel"]; owner?: { id: string; name: string }; businessDate?: string; totals: ReturnType<typeof emptyBatchTotals>; lowAmount: number; noWs: number; inGroup: number; snapshotDate: string };
  const byChannel = new Map<string, Row>();
  const byChannelMember = new Map<string, Row>();
  const byDayChannel = new Map<string, Row>();
  const byDayChannelMember = new Map<string, Row>();
  for (const entry of snapshotEntries) {
    if (!byChannel.has(entry.channel.id)) byChannel.set(entry.channel.id, {
      channel: entry.channel, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "",
    });
    const memberKey = `${entry.channel.id}:${entry.owner.id}`;
    if (!byChannelMember.has(memberKey)) byChannelMember.set(memberKey, {
      channel: entry.channel, owner: entry.owner,
      totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "",
    });
  }
  function accumulate(row: Row, entry: (typeof entries)[number]) {
    const value = entry.approvedRevision;
    if (!value) return;
    row.totals.newFans += value.dispatchCount;
    row.totals.duplicateFans += value.duplicateCount;
    row.totals.effectiveFans += value.effectiveCount;
    row.totals.noNumber += value.noWsCount;
    row.totals.replies += value.replyCount;
    row.totals.groupJoin += value.joinCount;
    row.totals.groupLeave += value.normalLeaveCount + value.abnormalLeaveCount;
    row.totals.abnormalGroupLeave = (row.totals.abnormalGroupLeave ?? 0) + value.abnormalLeaveCount;
    row.totals.expertIntro += value.expertIntroCount;
    row.totals.registration += value.registrationCount;
    row.totals.orders += value.orderCount;
    row.totals.rechargeCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents + value.cryptoRechargeCents + value.bankRechargeCents;
    row.totals.withdrawalCents += value.withdrawalCents;
    row.lowAmount += value.lowAmountCount; row.noWs += value.noWsCount;
    if (entry.position === "GROUP_OPERATOR") {
      if (entry.businessDate > row.snapshotDate) { row.snapshotDate = entry.businessDate; row.inGroup = value.currentInGroupCount; }
      else if (entry.businessDate === row.snapshotDate) row.inGroup += value.currentInGroupCount;
    }
  }
  for (const entry of entries) {
    if (!entry.approvedRevision) continue;
    const channelRow = byChannel.get(entry.channel.id) ?? { channel: entry.channel, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "" };
    accumulate(channelRow, entry); byChannel.set(entry.channel.id, channelRow);
    const memberKey = `${entry.channel.id}:${entry.owner.id}`;
    const memberRow = byChannelMember.get(memberKey) ?? { channel: entry.channel, owner: entry.owner, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "" };
    accumulate(memberRow, entry); byChannelMember.set(memberKey, memberRow);
    const dayChannelKey = `${entry.businessDate}:${entry.channel.id}`;
    const dayChannelRow = byDayChannel.get(dayChannelKey) ?? { channel: entry.channel, businessDate: entry.businessDate, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "" };
    accumulate(dayChannelRow, entry); byDayChannel.set(dayChannelKey, dayChannelRow);
    const dayMemberKey = `${dayChannelKey}:${entry.owner.id}`;
    const dayMemberRow = byDayChannelMember.get(dayMemberKey) ?? { channel: entry.channel, owner: entry.owner, businessDate: entry.businessDate, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "" };
    accumulate(dayMemberRow, entry); byDayChannelMember.set(dayMemberKey, dayMemberRow);
  }
  function serialize(row: Row) {
    return {
      normalizedName: row.channel.normalizedName, name: row.channel.name,
      totals: {
        added: row.totals.newFans, collision: row.totals.duplicateFans, lowAmount: row.lowAmount, noWs: row.noWs,
        effective: row.totals.effectiveFans, replied: row.totals.replies, joined: row.totals.groupJoin,
        left: row.totals.groupLeave, leftAbnormal: row.totals.abnormalGroupLeave ?? 0, inGroup: row.inGroup,
        pushed: row.totals.expertIntro, registered: row.totals.registration, ordered: row.totals.orders,
        depositCents: row.totals.rechargeCents, withdrawalCents: row.totals.withdrawalCents, netCents: row.totals.rechargeCents - row.totals.withdrawalCents,
      },
      rates: calculateConversionRates(row.totals),
    };
  }
  const rows = [...byChannel.values()].map((row) => {
    row.inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) => entry.channelId === row.channel.id));
    return {
      ...serialize(row),
      members: [...byChannelMember.values()].filter((member) => member.channel.id === row.channel.id).map((member) => {
        member.inGroup = sumLatestCurrentInGroup(snapshotEntries.filter((entry) =>
          entry.channelId === row.channel.id && entry.ownerId === member.owner!.id));
        return { ...serialize(member), id: member.owner!.id, name: member.owner!.name };
      }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  const days = [...new Set(entries.map((entry) => entry.businessDate))].sort().reverse().map((date) => ({
    date,
    rows: [...byDayChannel.values()].filter((row) => row.businessDate === date).map((row) => ({
      ...serialize(row),
      members: [...byDayChannelMember.values()]
        .filter((member) => member.businessDate === date && member.channel.id === row.channel.id)
        .map((member) => ({ ...serialize(member), id: member.owner!.id, name: member.owner!.name }))
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    })).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
  }));

  return NextResponse.json({ group: { id: group.id, name: group.name, timezone }, range: { preset: range.preset, label: range.label, today, from: range.from, to: range.to }, rows, days }, { headers: { "Cache-Control": "private, no-store" } });
}
