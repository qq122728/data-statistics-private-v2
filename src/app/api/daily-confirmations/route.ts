import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { hasAssignedRole } from "../../../lib/role-access";
import { hasOversizedQueryValue } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function getAuthenticatedUser() {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return null;
    throw error;
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!hasAssignedRole(user, "RECEPTION")) return authorizationDenied(user, "无权查看或确认今日数据");

  let body: { businessDate?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 }); }
  if (!isBusinessDate(body.businessDate)) return NextResponse.json({ error: "businessDate 必须是 YYYY-MM-DD" }, { status: 400 });
  const settings = await getSystemSettings();
  const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
  if (body.businessDate !== localDateYYYYMMDD(new Date(), timezone)) {
    return NextResponse.json({ error: "只能确认所在小组当地时间的今天" }, { status: 400 });
  }

  const existing = await db.dailyEntryConfirmation.findUnique({
    where: { userId_businessDate: { userId: user.id, businessDate: body.businessDate } },
  });
  const confirmation = await db.dailyEntryConfirmation.upsert({
    where: { userId_businessDate: { userId: user.id, businessDate: body.businessDate } },
    update: {},
    create: { userId: user.id, businessDate: body.businessDate },
  });
  return NextResponse.json({ confirmedAt: confirmation.confirmedAt, alreadyConfirmed: Boolean(existing) });
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "LEAD") return authorizationDenied(user, "无权查看或确认今日数据");

  const url = new URL(request.url);
  if (hasOversizedQueryValue(url.searchParams)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const businessDate = url.searchParams.get("businessDate");
  if (!isBusinessDate(businessDate)) return NextResponse.json({ error: "businessDate 必须是 YYYY-MM-DD" }, { status: 400 });

  const requestedGroupId = url.searchParams.get("groupId") || undefined;
  if (user.role === "LEAD" && (!user.groupId || (requestedGroupId && requestedGroupId !== user.groupId))) return authorizationDenied(user, "无权查看或确认今日数据");
  const groupId = user.role === "LEAD" ? user.groupId! : requestedGroupId;
  if (!groupId) return NextResponse.json({ error: "请选择小组" }, { status: 400 });

  const includeInactive = url.searchParams.get("includeInactive") === "1";
  const members = await db.user.findMany({
    where: {
      groupId,
      role: { in: ["LEAD", "RECEPTION"] },
      ...(includeInactive ? {} : { active: true }),
    },
    select: {
      id: true,
      name: true,
      role: true,
      active: true,
      confirmations: { where: { businessDate }, select: { confirmedAt: true } },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    groupId,
    businessDate,
    members: members.map((member) => ({
      userId: member.id,
      name: member.name,
      role: member.role,
      active: member.active,
      confirmed: member.confirmations.length > 0,
      confirmedAt: member.confirmations[0]?.confirmedAt ?? null,
    })),
  });
}
