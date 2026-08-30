import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { DailyStatError, dailyStatEntryInclude, publicDailyStat } from "../../../../lib/daily-stats";
import { db } from "../../../../lib/db";
import { expandResourceChannelIdsByType } from "../../../../lib/resource-channel-access";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

const reviewSchema = z.object({
  entryId: z.string().trim().min(1),
  action: z.literal("APPROVE"),
});

async function resourceActor() {
  try {
    const actor = await requireUser();
    if (!actor.active || !hasAssignedRole(actor, "RESOURCE_MANAGER"))
      return { actor, error: authorizationDenied(actor, "只有在职资源部账号可以审核每日数据") } as const;
    return { actor, error: null } as const;
  } catch (error) {
    if (error instanceof AuthenticationError)
      return { actor: null, error: NextResponse.json({ error: "请先登录" }, { status: 401 }) } as const;
    throw error;
  }
}

export async function GET() {
  const session = await resourceActor();
  if (session.error) return session.error;
  const channelIds = session.actor.resourceChannelAccess?.map((item) => item.channelId) ?? [];
  if (!channelIds.length) return NextResponse.json({ entries: [] });
  const entries = await db.dailyStatEntry.findMany({
    where: { status: "RESOURCE_PENDING", position: "RECEPTION", channelId: { in: channelIds } },
    include: dailyStatEntryInclude,
    orderBy: [{ businessDate: "desc" }, { groupId: "asc" }, { position: "asc" }, { submittedAt: "asc" }],
    take: 500,
  });
  return NextResponse.json({ entries: entries.map(publicDailyStat) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const session = await resourceActor();
  if (session.error) return session.error;
  try {
    const input = reviewSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: session.actor.id },
        select: { id: true, active: true, role: true, duty: true, resourceChannelAccess: { select: { channelId: true } } },
      });
      if (!actor?.active || !hasAssignedRole(actor, "RESOURCE_MANAGER"))
        throw new DailyStatError("只有在职资源部账号可以审核每日数据", 403);
      // 登录读取待核对列表时，资源部权限会按渠道类型扩展到所有小组的同类型渠道。
      // 确认动作必须在事务内重新执行同一套扩展，不能只使用数据库里作为“类型种子”的原始渠道，
      // 否则会出现列表看得到、点击确认却返回 404。
      const channelCatalog = await tx.channel.findMany({
        select: { id: true, channelType: true },
      });
      const allowedChannelIds = expandResourceChannelIdsByType(
        channelCatalog,
        actor.resourceChannelAccess.map((item) => item.channelId),
      );
      const entry = await tx.dailyStatEntry.findFirst({
        where: { id: input.entryId, position: "RECEPTION", channelId: { in: allowedChannelIds } },
        include: dailyStatEntryInclude,
      });
      if (!entry) throw new DailyStatError("未找到当前账号可审核的数据", 404);
      if (entry.status !== "RESOURCE_PENDING") throw new DailyStatError("这条数据已经处理，请刷新列表", 409);
      const reviewedAt = new Date();
      const updated = await tx.dailyStatEntry.update({
        where: { id: entry.id },
        data: {
          status: "APPROVED",
          approvedRevisionId: entry.currentRevisionId,
          reviewedById: actor.id,
          reviewedAt,
          reviewReason: null,
        },
        include: dailyStatEntryInclude,
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "DAILY_STAT_RESOURCE_APPROVED",
        entityType: "DailyStatEntry",
        entityId: entry.id,
        summary: { businessDate: entry.businessDate },
      });
      return updated;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ entry: publicDailyStat(result) });
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "请检查填写内容" }, { status: 400 });
    if (error instanceof DailyStatError) {
      if (error.status === 403) return authorizationDenied(session.actor, error.message);
      if (error.status === 401) return NextResponse.json({ error: error.message }, { status: 401 });
      if (error.status === 404) return NextResponse.json({ error: error.message }, { status: 404 });
      if (error.status === 409) return NextResponse.json({ error: error.message }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
