import { NextResponse } from "next/server";
import { loadChannelAnalysis } from "../../../../lib/analytics/channel-analysis";
import type { AnalysisScope } from "../../../../lib/analytics/types";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { hasAssignedRole } from "../../../../lib/role-access";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const allowedRanges = new Set(["all", "today", "yesterday", "7d", "30d", "month", "lastMonth", "custom"]);

/** 组长新版工作台的真实渠道汇总。只读本组，不承载“发给资源部审核”的写操作。 */
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
  const scope: AnalysisScope = {
    actorId: actor.id,
    role: "LEAD",
    groupIds: [group.id],
    groupId: group.id,
    sourceDateFrom: range.from,
    sourceDateTo: range.to,
    includeInactive: false,
    showInsufficient: false,
    requestedForbiddenGroup: false,
  };
  const result = await loadChannelAnalysis(scope, today);
  const rows = result.rows.map((row) => ({
    normalizedName: row.normalizedName,
    name: row.displayName,
    totals: {
      added: row.submitted ?? row.newFans,
      collision: row.duplicate ?? row.totals.duplicateFans,
      lowAmount: row.lowAmount ?? 0,
      noWs: row.noWs ?? row.totals.noNumber,
      effective: row.effective ?? row.totals.effectiveFans,
      replied: row.totals.replies,
      joined: row.totals.groupJoin,
      left: row.totals.groupLeave,
      leftAbnormal: row.totals.abnormalGroupLeave ?? 0,
      inGroup: row.currentInGroup,
      pushed: row.totals.expertIntro,
      registered: row.totals.registration,
      ordered: row.totals.orders,
      depositCents: row.totals.rechargeCents,
      withdrawalCents: row.totals.withdrawalCents,
      netCents: row.totals.rechargeCents - row.totals.withdrawalCents,
    },
    rates: row.rates,
  }));

  return NextResponse.json({
    group: { id: group.id, name: group.name, timezone: resolveGroupBusinessTime(group).timezone },
    range: { preset: range.preset, label: range.label, today, from: range.from, to: range.to },
    rows,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
