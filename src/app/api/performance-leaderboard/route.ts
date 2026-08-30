import { NextResponse } from "next/server";

import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { hasOversizedQueryValue } from "../../../lib/request-limits";
import { getSystemSettings } from "../../../lib/settings";
import { authorizationDenied } from "../../../lib/security-events";
import { managedDepartmentIds } from "../../../lib/managed-department-scope";

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
    return authorizationDenied(actor, "当前账号已停用");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });

  const settings = await getSystemSettings();
  const groupWhere = actor.role === "ADMIN" || actor.duty === "HQ_MANAGER"
    ? { active: true }
    : actor.duty === "COMPANY_MANAGER"
      ? { active: true, department: { active: true, companyId: actor.companyId ?? "__missing_company__" } }
      : actor.duty === "DEPARTMENT_MANAGER"
        ? { active: true, departmentId: { in: managedDepartmentIds(actor) }, department: { active: true } }
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

  const entries = groupIds.length ? await db.dailyStatEntry.findMany({
    where: {
      groupId: { in: groupIds }, businessDate: { gte: range.from, lte: range.to }, approvedRevisionId: { not: null },
      ...(channelIds ? { channelId: { in: channelIds } } : {}),
    },
    select: { groupId: true, position: true, ownerId: true, owner: { select: { id: true, name: true, active: true } }, approvedRevision: true },
  }) : [];
  type Sum = { joined: number; orders: number; depositCents: number; withdrawalCents: number };
  const fresh = (): Sum => ({ joined: 0, orders: 0, depositCents: 0, withdrawalCents: 0 });
  const groupSums = new Map<string, Sum>();
  const peopleByRole = new Map<string, { person: (typeof entries)[number]["owner"]; groupId: string; sum: Sum }>();
  for (const entry of entries) {
    const value = entry.approvedRevision;
    if (!value) continue;
    const groupSum = groupSums.get(entry.groupId) ?? fresh();
    if (entry.position === "RECEPTION") groupSum.joined += value.joinCount;
    if (entry.position === "EXPERT") {
      groupSum.orders += value.orderCount;
      groupSum.depositCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents + value.cryptoRechargeCents + value.bankRechargeCents;
      groupSum.withdrawalCents += value.withdrawalCents;
    }
    groupSums.set(entry.groupId, groupSum);
    const key = `${entry.position}:${entry.groupId}:${entry.ownerId}`;
    const personRow = peopleByRole.get(key) ?? { person: entry.owner, groupId: entry.groupId, sum: fresh() };
    if (entry.position === "RECEPTION") personRow.sum.joined += value.joinCount;
    if (entry.position === "GROUP_OPERATOR") personRow.sum.joined += value.operatorReceivedCount;
    if (entry.position === "EXPERT") {
      personRow.sum.orders += value.orderCount;
      personRow.sum.depositCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents + value.cryptoRechargeCents + value.bankRechargeCents;
      personRow.sum.withdrawalCents += value.withdrawalCents;
    }
    peopleByRole.set(key, personRow);
  }
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const rowsForRole = (position: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT") => [...peopleByRole.entries()]
    .filter(([key]) => key.startsWith(`${position}:`))
    .map(([, row]) => ({
      id: row.person.id, name: row.person.name, active: row.person.active,
      groupName: groupById.get(row.groupId)?.name ?? "未知小组", joined: row.sum.joined,
      orders: row.sum.orders, netCents: row.sum.depositCents - row.sum.withdrawalCents,
    }));

  return NextResponse.json({
    today,
    timezone,
    range,
    groups: groups.map((group) => {
      const sum = groupSums.get(group.id) ?? fresh();
      return {
        id: group.id, name: group.name, departmentName: group.department.name,
        countryCode: group.countryCode ?? group.department.countryCode,
        orders: sum.orders, joined: sum.joined, netCents: sum.depositCents - sum.withdrawalCents,
      };
    }),
    receptions: rowsForRole("RECEPTION"),
    operators: rowsForRole("GROUP_OPERATOR"),
    experts: rowsForRole("EXPERT"),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
