import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

/**
 * 资源部「核对收件箱」（需求文档4.5）：只列出当前登录资源部账号绑定渠道的待确认记录
 * （SENT）。已经处理完的（CONFIRMED/DISPUTED）不再出现在收件箱里，跟组长历史客户
 * 审核中心的"待审核列表"是同一种"收件箱只装待办"的设计。
 *
 * 渠道范围按当前账号明确绑定的渠道 ID 读取；不会按“同为投流/短信”自动扩权。
 */
export async function GET() {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !hasAssignedRole(actor, "RESOURCE_MANAGER"))
    return authorizationDenied(actor, "只有在职资源部账号可以查看核对收件箱");

  const allowedChannelIds = (await db.resourceChannelAccess.findMany({ where: { userId: actor.id }, select: { channelId: true } })).map((item) => item.channelId);
  if (!allowedChannelIds.length)
    return NextResponse.json({ entries: [] }, { headers: { "Cache-Control": "private, no-store" } });

  const entries = await db.channelReviewEntry.findMany({
    where: { channelId: { in: allowedChannelIds }, status: "SENT" },
    select: {
      id: true, reviewDate: true, status: true, sentAt: true,
      channel: { select: { name: true, normalizedName: true } },
      group: { select: { id: true, name: true } },
    },
    orderBy: [{ reviewDate: "desc" }, { sentAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({
    entries: entries.map((entry) => ({
      id: entry.id,
      reviewDate: entry.reviewDate,
      status: entry.status,
      sentAt: entry.sentAt,
      channelName: entry.channel.name,
      normalizedName: entry.channel.normalizedName,
      group: entry.group,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
