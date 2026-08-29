import { NextResponse } from "next/server";

import { loadChannelAnalysis } from "../../../../lib/analytics/channel-analysis";
import type { AnalysisScope } from "../../../../lib/analytics/types";
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
  const rows = await Promise.all(channels.map(async (channel) => {
    const timezone = resolveGroupBusinessTime(channel.group).timezone;
    const today = localDateYYYYMMDD(new Date(), timezone);
    const range = resolveDateRangeWithDefault({
      range: preset,
      sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
      sourceDateTo: params.get("sourceDateTo") ?? undefined,
    }, today, "month");
    const scope: AnalysisScope = {
      actorId: actor.id, role: "RESOURCE_MANAGER", groupIds: [channel.group.id], groupId: channel.group.id,
      channelIds: [channel.id], sourceDateFrom: range.from, sourceDateTo: range.to,
      includeInactive: false, showInsufficient: false, requestedForbiddenGroup: false,
    };
    const analysis = await loadChannelAnalysis(scope, today);
    const row = analysis.rows[0];
    const totals = row?.totals;
    return {
      channel: { id: channel.id, name: channel.name, normalizedName: channel.normalizedName },
      group: { id: channel.group.id, name: channel.group.name, departmentName: channel.group.department.name },
      period: { preset: range.preset, from: range.from, to: range.to, today, timezone },
      totals: {
        added: row?.submitted ?? row?.newFans ?? 0,
        collision: row?.duplicate ?? totals?.duplicateFans ?? 0,
        lowAmount: row?.lowAmount ?? 0,
        noWs: row?.noWs ?? totals?.noNumber ?? 0,
        effective: row?.effective ?? totals?.effectiveFans ?? 0,
        replied: totals?.replies ?? 0,
        joined: totals?.groupJoin ?? 0,
        left: totals?.groupLeave ?? 0,
        abnormalLeft: totals?.abnormalGroupLeave ?? 0,
        inGroup: row?.currentInGroup ?? 0,
        pushed: totals?.expertIntro ?? 0,
        registered: totals?.registration ?? 0,
        ordered: totals?.orders ?? 0,
        depositCents: totals?.rechargeCents ?? 0,
        withdrawalCents: totals?.withdrawalCents ?? 0,
      },
    };
  }));

  return NextResponse.json({
    rows,
    channels: [...new Map(rows.map((row) => [row.channel.id, row.channel])).values()],
    groups: [...new Map(rows.map((row) => [row.group.id, row.group])).values()],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
