import { NextResponse } from "next/server";

import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { db } from "../../../../lib/db";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";

/** 号码导入页面的真实选项，只返回当前接粉所在小组的数据。 */
export async function GET() {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }

  if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "RECEPTION"))
    return authorizationDenied(actor, "只有在职接粉可以导入客户号码");

  const settings = await getSystemSettings();
  const timezone = await resolveUserBusinessTimezone(actor, settings.timezone);
  const [channels, attributionOwners] = await Promise.all([
    db.channel.findMany({
      where: { groupId: actor.groupId, active: true },
      select: { id: true, name: true, channelType: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.user.findMany({
      where: { groupId: actor.groupId, active: true },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);

  return NextResponse.json({
    today: localDateYYYYMMDD(new Date(), timezone),
    timezone,
    channels,
    attributionOwners,
    currentUserId: actor.id,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
