import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { DailyStatError, dailyStatEntryInclude, publicDailyStat } from "../../../../lib/daily-stats";
import { db } from "../../../../lib/db";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

const reviewSchema = z.object({
  entryId: z.string().trim().min(1),
  action: z.enum(["APPROVE", "RETURN"]),
  reason: z.string().trim().max(500).nullable().optional(),
}).superRefine((value, context) => {
  if (value.action === "RETURN" && !value.reason)
    context.addIssue({ code: "custom", path: ["reason"], message: "退回时必须填写原因" });
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
      const allowedChannelIds = actor.resourceChannelAccess.map((item) => item.channelId);
      const entry = await tx.dailyStatEntry.findFirst({
        where: { id: input.entryId, position: "RECEPTION", channelId: { in: allowedChannelIds } },
        include: dailyStatEntryInclude,
      });
      if (!entry) throw new DailyStatError("未找到当前账号可审核的数据", 404);
      if (entry.status !== "RESOURCE_PENDING") throw new DailyStatError("这条数据已经处理，请刷新列表", 409);
      const reviewedAt = new Date();
      const updated = await tx.dailyStatEntry.update({
        where: { id: entry.id },
        data: input.action === "APPROVE" ? {
          status: "APPROVED",
          approvedRevisionId: entry.currentRevisionId,
          reviewedById: actor.id,
          reviewedAt,
          reviewReason: null,
        } : {
          status: "RETURNED",
          reviewedById: actor.id,
          reviewedAt,
          reviewReason: input.reason!.trim(),
        },
        include: dailyStatEntryInclude,
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: input.action === "APPROVE" ? "DAILY_STAT_RESOURCE_APPROVED" : "DAILY_STAT_RESOURCE_RETURNED",
        entityType: "DailyStatEntry",
        entityId: entry.id,
        summary: { businessDate: entry.businessDate, reason: input.reason || null },
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
