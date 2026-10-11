import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { orderCohortDetails, orderCohorts } from "../../../../lib/order-cohorts";
import { intakeQuality } from "../../../../lib/intake-quality";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied, authorizationErrorResponse } from "../../../../lib/security-events";
import { statisticsDate } from "../../../../lib/statistics-date";

const allowedRanges = new Set(["today", "yesterday", "7d", "week", "30d", "month", "lastMonth", "custom"]);

/** Top-level administrators' read-only detail behind the existing order totals. */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof AuthorizationError) return authorizationErrorResponse(error, error.message);
    throw error;
  }
  if (actor.role !== "ADMIN" && actor.duty !== "HQ_MANAGER")
    return authorizationDenied(actor, "只有系统管理员或总公司管理员可以查看开单来源");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const rawRange = params.get("range") ?? "";
  const today = statisticsDate();
  const range = resolveDateRangeWithDefault({
    range: allowedRanges.has(rawRange) ? rawRange : undefined,
    sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
    sourceDateTo: params.get("sourceDateTo") ?? undefined,
  }, today, "month");
  const groups = await db.teamGroup.findMany({ where: { active: true, groupType: "HACKER" }, select: { id: true } });
  const groupIds = new Set(groups.map((group) => group.id));
  const rows = await db.customerSheetRow.findMany({
    where: { data: { contains: '"intakeOn"' } },
    select: { id: true, groupId: true, phone: true, data: true },
  });
  const cohorts = orderCohorts(rows, groupIds, range.from, range.to);
  const details = orderCohortDetails(rows, groupIds, range.from, range.to);
  const quality = intakeQuality(rows, groupIds, range.from, range.to, today);
  const channelIds = [...new Set(cohorts.map((cohort) => cohort.channelId))];
  const channels = channelIds.length ? await db.channel.findMany({
    where: { id: { in: channelIds } },
    select: { id: true, groupId: true, name: true },
  }) : [];
  const channelNames = new Map(channels.map((channel) => [JSON.stringify([channel.groupId, channel.id]), channel.name]));
  return NextResponse.json({
    range: { from: range.from, to: range.to, label: range.label },
    quality: { asOf: today, previousFrom: quality.previousFrom, previousTo: quality.previousTo, rows: quality.rows },
    rows: cohorts.map((cohort) => ({
      ...cohort,
      channelName: channelNames.get(JSON.stringify([cohort.groupId, cohort.channelId])) ?? "原渠道",
    })),
    details: details.map((detail) => ({
      ...detail,
      channelName: channelNames.get(JSON.stringify([detail.groupId, detail.channelId])) ?? "原渠道",
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
