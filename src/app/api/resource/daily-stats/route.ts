import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { DailyStatError, dailyStatEntryInclude, isUnifiedDailyStatIdentity, publicDailyStat } from "../../../../lib/daily-stats";
import { db } from "../../../../lib/db";
import { usesCustomerNumberTracking } from "../../../../lib/customer-number-tracking";
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
      // 资源账号严格按明确绑定的渠道目录 ID 审核。一个目录 ID 可以在多个小组有副本，
      // 但不能因为另一个渠道同为 ADS/SMS，就自动获得那个渠道的权限。
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
        data: {
          status: "APPROVED",
          approvedRevisionId: entry.currentRevisionId,
          reviewedById: actor.id,
          reviewedAt,
          reviewReason: null,
        },
        include: dailyStatEntryInclude,
      });
      // 新版组员日报已把基础、炒群、专家和资金合在一条 RECEPTION 存储行。
      // 审核通过的同一刻才停用旧岗位行，避免新行还在待审时报表突然少数；
      // 仅清除 approvedRevisionId，所有旧修订和操作人仍完整保留。
      const numberTrackedReception = entry.group.groupType === "HACKER" && usesCustomerNumberTracking(entry.businessDate);
      if (isUnifiedDailyStatIdentity(entry.identityKey) && !numberTrackedReception) {
        const legacyCompanions = await tx.dailyStatEntry.findMany({
          where: {
            id: { not: entry.id },
            groupId: entry.groupId,
            channelId: entry.channelId,
            businessDate: entry.businessDate,
            position: { in: ["GROUP_OPERATOR", "EXPERT"] },
            approvedRevisionId: { not: null },
            OR: [
              { ownerId: entry.ownerId },
              { sourceReceptionId: entry.ownerId },
            ],
          },
          select: {
            id: true,
            position: true,
            approvedRevision: true,
          },
        });
        const legacyTotals = legacyCompanions.reduce((totals, companion) => {
          const revision = companion.approvedRevision;
          if (!revision) return totals;
          if (companion.position === "GROUP_OPERATOR") {
            totals.normalLeaveCount += revision.normalLeaveCount;
            totals.abnormalLeaveCount += revision.abnormalLeaveCount;
            totals.currentInGroupCount += revision.currentInGroupCount;
            totals.expertIntroCount += revision.expertIntroCount;
          } else if (companion.position === "EXPERT") {
            totals.expertContactedCount += revision.expertContactedCount;
            totals.registrationCount += revision.registrationCount;
            totals.orderCount += revision.orderCount;
            totals.cryptoInitialDepositCents += revision.cryptoInitialDepositCents;
            totals.bankInitialDepositCents += revision.bankInitialDepositCents;
            totals.cryptoRechargeCents += revision.cryptoRechargeCents;
            totals.bankRechargeCents += revision.bankRechargeCents;
            totals.withdrawalCents += revision.withdrawalCents;
          }
          return totals;
        }, {
          normalLeaveCount: 0,
          abnormalLeaveCount: 0,
          currentInGroupCount: 0,
          expertIntroCount: 0,
          expertContactedCount: 0,
          registrationCount: 0,
          orderCount: 0,
          cryptoInitialDepositCents: 0,
          bankInitialDepositCents: 0,
          cryptoRechargeCents: 0,
          bankRechargeCents: 0,
          withdrawalCents: 0,
        });
        const unifiedRevision = entry.currentRevision;
        const coversLegacyValues = unifiedRevision
          ? Object.entries(legacyTotals).every(([field, value]) =>
              unifiedRevision[field as keyof typeof legacyTotals] === value,
            )
          : false;
        // 老前端可能仍只提交“接粉基础字段”。这时不能把旧炒群/专家行停掉，
        // 否则审核后会丢失历史漏斗与资金。统一页面会先读取合并值再保存；
        // 已审核历史的人工纠正则带 changeReason，明确表示新版行应取代旧行。
        if (legacyCompanions.length && (coversLegacyValues || Boolean(unifiedRevision?.changeReason))) {
          await tx.dailyStatEntry.updateMany({
            where: { id: { in: legacyCompanions.map((companion) => companion.id) } },
          data: {
            status: "RETURNED",
            approvedRevisionId: null,
            reviewedById: actor.id,
            reviewedAt,
            reviewReason: `已并入统一组员日报 ${entry.id}`,
          },
          });
        }
      }
      await recordAudit(tx, {
        actorId: actor.id,
        action: "DAILY_STAT_RESOURCE_APPROVED",
        entityType: "DailyStatEntry",
        entityId: entry.id,
        summary: {
          businessDate: entry.businessDate,
          groupId: entry.groupId,
          channelId: entry.channelId,
          ownerId: entry.ownerId,
          approvedRevisionId: entry.currentRevisionId,
        },
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
