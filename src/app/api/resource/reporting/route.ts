import { NextResponse } from "next/server";

import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

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
          id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true,
          department: { select: { name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
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
      businessDate: true,
      position: true,
      approvedRevision: true,
    },
  }) : [];

  const rows = channelPeriods.map(({ channel, timezone, today, range }) => {
    const scoped = entries.filter((entry) => entry.channelId === channel.id && entry.groupId === channel.group.id
      && entry.businessDate >= range.from && entry.businessDate <= range.to && entry.approvedRevision);
    const totals = scoped.reduce((sum, entry) => {
      const revision = entry.approvedRevision!;
      sum.added += revision.dispatchCount;
      sum.collision += revision.duplicateCount;
      sum.lowAmount += revision.lowAmountCount;
      sum.noWs += revision.noWsCount;
      sum.effective += revision.effectiveCount;
      sum.replied += revision.replyCount;
      sum.joined += revision.joinCount;
      sum.left += revision.normalLeaveCount + revision.abnormalLeaveCount;
      sum.abnormalLeft += revision.abnormalLeaveCount;
      sum.pushed += revision.expertIntroCount;
      sum.registered += revision.registrationCount;
      sum.ordered += revision.orderCount;
      sum.depositCents += revision.cryptoInitialDepositCents + revision.bankInitialDepositCents
        + revision.cryptoRechargeCents + revision.bankRechargeCents;
      sum.withdrawalCents += revision.withdrawalCents;
      return sum;
    }, {
      added: 0, collision: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0,
      left: 0, abnormalLeft: 0, pushed: 0, registered: 0, ordered: 0, depositCents: 0,
      withdrawalCents: 0,
    });
    const latestOperatorDate = scoped.filter((entry) => entry.position === "GROUP_OPERATOR")
      .map((entry) => entry.businessDate).sort().at(-1);
    const inGroup = latestOperatorDate ? scoped
      .filter((entry) => entry.position === "GROUP_OPERATOR" && entry.businessDate === latestOperatorDate)
      .reduce((sum, entry) => sum + entry.approvedRevision!.currentInGroupCount, 0) : 0;
    return {
      channel: { id: channel.id, name: channel.name, normalizedName: channel.normalizedName },
      group: { id: channel.group.id, name: channel.group.name, departmentName: channel.group.department.name },
      period: { preset: range.preset, from: range.from, to: range.to, today, timezone },
      totals: {
        ...totals,
        inGroup,
      },
    };
  });

  return NextResponse.json({
    rows,
    channels: [...new Map(rows.map((row) => [row.channel.id, row.channel])).values()],
    groups: [...new Map(rows.map((row) => [row.group.id, row.group])).values()],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
