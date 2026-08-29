import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireUser } from "../../../../lib/auth";
import { buildGroupBusinessPeriods } from "../../../../lib/analytics/group-business-periods";
import { loadTeamPerformance } from "../../../../lib/analytics/team-performance";
import type { AnalysisScope, ManagementRole } from "../../../../lib/analytics/types";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { db } from "../../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { hasAssignedRole } from "../../../../lib/role-access";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied, authorizationErrorResponse } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";

const allowedRanges = new Set(["all", "today", "yesterday", "7d", "30d", "month", "lastMonth", "custom"]);

/**
 * 新版管理端共用的真实统计入口。它只负责三件事：
 * 1) 按当前账号的 Duty/组长身份解出允许查看的小组；
 * 2) 复用旧系统已经验证过的 team-performance 口径，不在 v2 前端重新算一套；
 * 3) 把同一个“今日/近7天/当月”按每个小组自己的当地日期换算。
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
  const canRead = isLead || actor.duty === "DEPARTMENT_MANAGER" || actor.duty === "COMPANY_MANAGER" || actor.duty === "HQ_MANAGER";
  if (!canRead) return authorizationDenied(actor, "该账号不能查看组织业绩");

  const groupWhere = actor.duty === "HQ_MANAGER"
    ? { active: true }
    : actor.duty === "COMPANY_MANAGER"
      ? { active: true, department: { active: true, companyId: actor.companyId ?? "__missing_company__" } }
      : actor.duty === "DEPARTMENT_MANAGER"
        ? { active: true, departmentId: actor.departmentId ?? "__missing_department__", department: { active: true } }
        : { active: true, id: actor.groupId ?? "__missing_group__" };

  const accessibleGroups = await db.teamGroup.findMany({
    where: groupWhere,
    select: {
      id: true,
      name: true,
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
  const fallbackToday = localDateYYYYMMDD(now, settings.timezone);
  const rawRange = params.get("range") ?? undefined;
  const range = resolveDateRangeWithDefault({
    range: rawRange && allowedRanges.has(rawRange) ? rawRange : undefined,
    sourceDateFrom: params.get("sourceDateFrom") ?? undefined,
    sourceDateTo: params.get("sourceDateTo") ?? undefined,
  }, fallbackToday, "month");
  const periods = buildGroupBusinessPeriods(selectedGroups, now, range);

  const scope: AnalysisScope = {
    actorId: actor.id,
    role: actor.role as ManagementRole,
    groupIds: selectedGroups.map((group) => group.id),
    groupId: requestedGroupId || undefined,
    sourceDateFrom: range.from,
    sourceDateTo: range.to,
    includeInactive: false,
    showInsufficient: false,
    requestedForbiddenGroup: false,
  };
  const performance = await loadTeamPerformance(scope, fallbackToday, { groupPeriods: periods });

  const lowAndNoWsByGroup = new Map<string, { lowAmount: number; noWs: number }>();
  for (const row of performance.dailyRows) {
    const current = lowAndNoWsByGroup.get(row.groupId) ?? { lowAmount: 0, noWs: 0 };
    current.lowAmount += row.lowAmount;
    current.noWs += row.noWs;
    lowAndNoWsByGroup.set(row.groupId, current);
  }

  const currentGroupCustomers = selectedGroups.length ? await db.leadCustomer.findMany({
    where: {
      invalid: false,
      receptionCategory: { notIn: ["INVALID", "LOW_AMOUNT", "NO_WS"] },
      joinedOn: { not: null },
      batch: { groupId: { in: selectedGroups.map((group) => group.id) } },
    },
    select: { joinedOn: true, leftOn: true, batch: { select: { groupId: true } } },
  }) : [];

  const metadataByGroup = new Map(selectedGroups.map((group) => [group.id, group]));
  const groups = performance.groupRows.map((row) => {
    const metadata = metadataByGroup.get(row.groupId)!;
    const period = periods[row.groupId];
    const invalidBreakdown = lowAndNoWsByGroup.get(row.groupId) ?? { lowAmount: 0, noWs: 0 };
    const abnormalLeave = row.totals.abnormalGroupLeave ?? 0;
    const currentInGroup = currentGroupCustomers.filter((customer) => customer.batch.groupId === row.groupId
      && Boolean(customer.joinedOn && customer.joinedOn <= period.today)
      && (!customer.leftOn || customer.leftOn > period.today)).length;
    return {
      id: row.groupId,
      name: row.groupName,
      department: { id: metadata.department.id, name: metadata.department.name },
      company: metadata.department.company,
      timezone: resolveGroupBusinessTime(metadata).timezone,
      period,
      activePeople: row.activePeople,
      totals: {
        added: row.totals.newFans,
        collision: row.totals.duplicateFans,
        lowAmount: invalidBreakdown.lowAmount,
        noWs: invalidBreakdown.noWs,
        effective: row.totals.effectiveFans,
        replied: row.totals.replies,
        joined: row.totals.groupJoin,
        leftNormal: Math.max(0, row.totals.groupLeave - abnormalLeave),
        leftAbnormal: abnormalLeave,
        inGroup: currentInGroup,
        pushed: row.totals.expertIntro,
        registered: row.totals.registration,
        ordered: row.totals.orders,
        depositCents: row.totals.rechargeCents,
        withdrawalCents: row.totals.withdrawalCents,
        netCents: row.totals.rechargeCents - row.totals.withdrawalCents,
      },
      rates: row.rates,
    };
  });

  const members = performance.memberRows.map((row) => ({
    id: row.userId,
    name: row.name,
    groupId: row.groupId,
    groupName: row.groupName,
    active: row.active,
    totals: {
      added: row.totals.newFans,
      collision: row.totals.duplicateFans,
      effective: row.totals.effectiveFans,
      replied: row.totals.replies,
      joined: row.totals.groupJoin,
      left: row.totals.groupLeave,
      leftAbnormal: row.totals.abnormalGroupLeave ?? 0,
      pushed: row.totals.expertIntro,
      registered: row.totals.registration,
      ordered: row.totals.orders,
      depositCents: row.totals.rechargeCents,
      withdrawalCents: row.totals.withdrawalCents,
      netCents: row.totals.rechargeCents - row.totals.withdrawalCents,
    },
    rates: row.rates,
  }));

  return NextResponse.json({ range: { preset: range.preset, label: range.label }, groups, members }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
