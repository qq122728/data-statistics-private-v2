import { NextResponse } from "next/server";

import { loadPerformanceLeaderboard } from "../../../lib/analytics/performance-leaderboard-query";
import { loadRoleRankings } from "../../../lib/analytics/role-rankings";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { hasOversizedQueryValue } from "../../../lib/request-limits";
import { getSystemSettings } from "../../../lib/settings";

export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active)
    return NextResponse.json({ error: "当前账号已停用" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });

  const settings = await getSystemSettings();
  const groupWhere = actor.duty === "HQ_MANAGER"
    ? { active: true }
    : actor.duty === "COMPANY_MANAGER"
      ? { active: true, department: { active: true, companyId: actor.companyId ?? "__missing_company__" } }
      : actor.duty === "DEPARTMENT_MANAGER"
        ? { active: true, departmentId: actor.departmentId ?? "__missing_department__", department: { active: true } }
        : actor.role === "COMPANY_MANAGER"
          ? {
              active: true,
              departmentId: actor.departmentId ?? "__missing_department__",
              ...(actor.managementCountryCode ? { OR: [{ countryCode: actor.managementCountryCode }, { countryCode: null, department: { countryCode: actor.managementCountryCode } }] } : {}),
            }
          : { active: true };
  const groups = await db.teamGroup.findMany({
      where: groupWhere,
      select: {
        id: true,
        name: true,
        departmentId: true,
        countryCode: true,
        department: { select: { name: true, countryCode: true } },
      },
      orderBy: { name: "asc" },
    });
  const timezone = await resolveUserBusinessTimezone(actor, settings.timezone);
  const today = localDateYYYYMMDD(new Date(), timezone);
  const range = resolveDateRangeWithDefault(Object.fromEntries(params), today, "month");

  // 精英榜是公开的小组榜；普通一线和组长看全局公开排名，不会获得客户明细。
  // 公司/部门管理员及资源部仍沿用后端既有的数据范围，避免越权看到范围外小组。
  const groupIds = groups.map((group) => group.id);
  const channelIds = actor.role === "RESOURCE_MANAGER"
    ? (actor.resourceChannelAccess ?? []).map((access) => access.channelId)
    : undefined;

  const [groupRows, roleRows] = await Promise.all([
    loadPerformanceLeaderboard({
      groupIds,
      sourceDateFrom: range.from,
      sourceDateTo: range.to,
      today,
      channelIds,
    }),
    loadRoleRankings({
      groupIds,
      sourceDateFrom: range.from,
      sourceDateTo: range.to,
      today,
      channelIds,
    }),
  ]);

  return NextResponse.json({
    today,
    timezone,
    range,
    groups: groupRows.map((row) => ({
      id: row.groupId,
      name: row.groupName,
      departmentName: row.departmentName,
      countryCode: row.countryCode,
      orders: row.orders,
      joined: row.groupJoin,
      netCents: row.netPerformanceCents,
    })),
    receptions: roleRows.reception.map((row) => ({
      id: row.id,
      name: row.name,
      groupName: row.groupName,
      active: row.active,
      joined: row.joined,
      orders: row.orders,
      netCents: row.netCents,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
