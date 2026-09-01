import { NextResponse } from "next/server";

import { loadRoleRankings } from "../../../../lib/analytics/role-rankings";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../../lib/business-time";
import { statisticsDate } from "../../../../lib/statistics-date";
import { resolveDateRangeWithDefault } from "../../../../lib/lead-date-range";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";

export async function GET(request: Request) {
  let actor;
  try { actor = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "LEAD"))
    return authorizationDenied(actor, "当前账号没有组长看板权限");
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const settings = await getSystemSettings();
  const timezone = await resolveUserBusinessTimezone(actor, settings.timezone);
  const today = statisticsDate();
  const range = resolveDateRangeWithDefault(Object.fromEntries(params), today, "month");
  const rows = await loadRoleRankings({ groupIds: [actor.groupId], sourceDateFrom: range.from, sourceDateTo: range.to, today });
  const mine = rows.experts.find((row) => row.id === actor.id);
  const group = rows.groups.find((row) => row.id === actor.groupId);
  const groupAssigned = rows.experts.reduce((sum, row) => sum + row.assigned, 0);
  const myAssigned = mine?.assigned ?? 0;
  return NextResponse.json({
    today, timezone, range,
    person: { name: actor.name, customers: myAssigned, orders: mine?.orders ?? 0, netCents: mine?.netCents ?? 0 },
    group: { name: group?.name ?? "本组", customers: groupAssigned, orders: group?.orders ?? 0, netCents: group?.netCents ?? 0 },
    share: groupAssigned ? myAssigned / groupAssigned : null,
    alsoExpert: hasAssignedRole(actor, "EXPERT"),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
