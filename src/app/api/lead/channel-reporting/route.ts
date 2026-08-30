import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { calculateConversionRates, emptyBatchTotals } from "../../../../lib/metrics";
import { hasAssignedRole } from "../../../../lib/role-access";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const allowedRanges = new Set(["all", "today", "yesterday", "7d", "30d", "month", "lastMonth", "custom"]);

/** 组长新版工作台的真实渠道汇总。统计只来自组长审核通过的每日填写。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "LEAD"))
    return authorizationDenied(actor, "只有在职组长可以查看本组渠道数据");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });

  const group = await db.teamGroup.findFirst({
    where: { id: actor.groupId, active: true },
    select: {
      id: true, name: true, countryCode: true, timezone: true,
      workStartMinutes: true, workEndMinutes: true,
      department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
  });
  if (!group) return authorizationDenied(actor, "当前账号没有可查看的小组");

  const today = localDateYYYYMMDD(new Date(), resolveGroupBusinessTime(group).timezone);
  const rawRange = params.get("range") ?? undefined;
  const range = resolveDateRangeWithDefault({
    range: rawRange && allowedRanges.has(rawRange) ? rawRange : undefined,
    sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
    sourceDateTo: params.get("sourceDateTo") ?? undefined,
  }, today, "month");
  const entries = await db.dailyStatEntry.findMany({
    where: { groupId: group.id, businessDate: { gte: range.from, lte: range.to }, approvedRevisionId: { not: null } },
    select: {
      businessDate: true,
      position: true,
      owner: { select: { id: true, name: true } },
      channel: { select: { id: true, name: true, normalizedName: true } },
      approvedRevision: true,
    },
  });
  type Row = { channel: (typeof entries)[number]["channel"]; owner?: { id: string; name: string }; totals: ReturnType<typeof emptyBatchTotals>; lowAmount: number; noWs: number; inGroup: number; snapshotDate: string };
  const byChannel = new Map<string, Row>();
  const byChannelMember = new Map<string, Row>();
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
    row.lowAmount += value.lowAmountCount;
    row.noWs += value.noWsCount;
    if (entry.position === "GROUP_OPERATOR") {
      if (entry.businessDate > row.snapshotDate) { row.snapshotDate = entry.businessDate; row.inGroup = value.currentInGroupCount; }
      else if (entry.businessDate === row.snapshotDate) row.inGroup += value.currentInGroupCount;
    }
  }
  for (const entry of entries) {
    const value = entry.approvedRevision;
    if (!value) continue;
    const row = byChannel.get(entry.channel.id) ?? { channel: entry.channel, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "" };
    accumulate(row, entry);
    byChannel.set(entry.channel.id, row);
    const memberKey = `${entry.channel.id}:${entry.owner.id}`;
    const memberRow = byChannelMember.get(memberKey) ?? { channel: entry.channel, owner: entry.owner, totals: emptyBatchTotals(), lowAmount: 0, noWs: 0, inGroup: 0, snapshotDate: "" };
    accumulate(memberRow, entry);
    byChannelMember.set(memberKey, memberRow);
  }
  function serialize(row: Row) { return {
    normalizedName: row.channel.normalizedName,
    name: row.channel.name,
    totals: {
      added: row.totals.newFans,
      collision: row.totals.duplicateFans,
      lowAmount: row.lowAmount,
      noWs: row.noWs,
      effective: row.totals.effectiveFans,
      replied: row.totals.replies,
      joined: row.totals.groupJoin,
      left: row.totals.groupLeave,
      leftAbnormal: row.totals.abnormalGroupLeave ?? 0,
      inGroup: row.inGroup,
      pushed: row.totals.expertIntro,
      registered: row.totals.registration,
      ordered: row.totals.orders,
      depositCents: row.totals.rechargeCents,
      withdrawalCents: row.totals.withdrawalCents,
      netCents: row.totals.rechargeCents - row.totals.withdrawalCents,
    },
    rates: calculateConversionRates(row.totals),
  }; }
  const rows = [...byChannel.values()].map((row) => ({
    ...serialize(row),
    members: [...byChannelMember.values()].filter((member) => member.channel.id === row.channel.id).map((member) => ({
      ...serialize(member),
      id: member.owner!.id,
      name: member.owner!.name,
    })).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
  })).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return NextResponse.json({
    group: { id: group.id, name: group.name, timezone: resolveGroupBusinessTime(group).timezone },
    range: { preset: range.preset, label: range.label, today, from: range.from, to: range.to },
    rows,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
