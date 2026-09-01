import { NextResponse } from "next/server";
import { z } from "zod";
import { loadChannelAnalysis } from "../../../../lib/analytics/channel-analysis";
import type { AnalysisScope } from "../../../../lib/analytics/types";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { normalizeChannelName } from "../../../../lib/channel-names";
import { isCalendarDate } from "../../../../lib/dates";
import { statisticsDate } from "../../../../lib/statistics-date";
import { db } from "../../../../lib/db";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";

/**
 * 组长「渠道数据核对」页面的发送资源部审核入口（需求文档4.5）。GET 读回本组
 * 所有渠道+日期的对账状态（发送资源部审核后的回执），POST 是发送/重新发送动作。
 * 渠道+日期是否真实存在，复用 channel-reporting 已经在用的 loadChannelAnalysis，
 * 不另开一条校验路径。
 */
const sendSchema = z.object({
  normalizedName: z.string().trim().min(1, "请选择渠道").max(100, "渠道名称过长"),
  reviewDate: z.string().refine(isCalendarDate, "请填写正确的日期"),
});

async function leadActor() {
  try {
    const actor = await requireUser();
    if (!hasAssignedRole(actor, "LEAD")) return { actor, error: authorizationDenied(actor, "只有组长可以核对渠道数据") } as const;
    if (!actor.groupId) return { actor, error: authorizationDenied(actor, "当前组长未绑定小组") } as const;
    return { actor, error: null } as const;
  } catch (error) {
    if (error instanceof AuthenticationError)
      return { actor: null, error: NextResponse.json({ error: "请先登录" }, { status: 401 }) } as const;
    throw error;
  }
}

export async function GET() {
  const session = await leadActor();
  if (session.error) return session.error;
  const entries = await db.channelReviewEntry.findMany({
    where: { groupId: session.actor.groupId! },
    select: {
      reviewDate: true, status: true, note: true, sentAt: true, reviewedAt: true,
      channel: { select: { normalizedName: true, name: true } },
    },
    orderBy: { reviewDate: "desc" },
    take: 200,
  });
  return NextResponse.json({
    entries: entries.map((entry) => ({
      normalizedName: entry.channel.normalizedName,
      channelName: entry.channel.name,
      reviewDate: entry.reviewDate,
      status: entry.status,
      note: entry.note,
      sentAt: entry.sentAt,
      reviewedAt: entry.reviewedAt,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await leadActor();
  if (session.error) return session.error;
  const sessionUser = session.actor;
  try {
    const input = sendSchema.parse(await request.json());
    const normalizedName = normalizeChannelName(input.normalizedName);

    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } },
      });
      if (!actor?.active || !actor.groupId || !hasAssignedRole(actor, "LEAD"))
        return { status: 403 as const, error: "只有组长可以核对渠道数据" };

      const group = await tx.teamGroup.findFirst({
        where: { id: actor.groupId, active: true },
        select: {
          id: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true,
          department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
        },
      });
      if (!group) return { status: 404 as const, error: "当前账号没有可核对的小组" };

      const channel = await tx.channel.findFirst({
        where: { groupId: group.id, normalizedName, active: true },
        select: { id: true, groupId: true },
      });
      if (!channel) return { status: 404 as const, error: "未找到本组这个渠道" };

      const today = statisticsDate();
      if (input.reviewDate > today) return { status: 400 as const, error: "不能核对未来日期的数据" };

      const scope: AnalysisScope = {
        actorId: actor.id, role: "LEAD", groupIds: [group.id], groupId: group.id,
        channelIds: [channel.id], sourceDateFrom: input.reviewDate, sourceDateTo: input.reviewDate,
        includeInactive: false, showInsufficient: false, requestedForbiddenGroup: false,
      };
      const analysis = await loadChannelAnalysis(scope, today);
      if (!analysis.rows.length) return { status: 400 as const, error: "这个渠道在这一天没有可核对的数据" };

      const existing = await tx.channelReviewEntry.findUnique({
        where: { groupId_channelId_reviewDate: { groupId: group.id, channelId: channel.id, reviewDate: input.reviewDate } },
        select: { id: true, status: true },
      });
      // 已确认是终态（需求文档4.5：不能撤销），组长不能再改这一天的提交。
      if (existing?.status === "CONFIRMED")
        return { status: 409 as const, error: "资源部已确认这一天的数据，不能重新发送" };

      const now = new Date();
      const entry = await tx.channelReviewEntry.upsert({
        where: { groupId_channelId_reviewDate: { groupId: group.id, channelId: channel.id, reviewDate: input.reviewDate } },
        create: { groupId: group.id, channelId: channel.id, reviewDate: input.reviewDate, status: "SENT", sentById: actor.id, sentAt: now },
        // 重新发送（多半是资源部标了异议、组长核实修正之后）视为一次全新提交：
        // 重置成 SENT、清空上一轮异议说明和审核痕迹。
        update: { status: "SENT", note: null, sentById: actor.id, sentAt: now, reviewedById: null, reviewedAt: null },
        select: { id: true, status: true, reviewDate: true },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: existing ? "CHANNEL_REVIEW_RESENT" : "CHANNEL_REVIEW_SENT",
        entityType: "ChannelReviewEntry",
        entityId: entry.id,
        summary: { normalizedName, reviewDate: input.reviewDate },
      });
      return { status: 200 as const, entry: { normalizedName, reviewDate: entry.reviewDate, status: entry.status } };
    }, { isolationLevel: "Serializable" });

    if (result.status === 403) return authorizationDenied(sessionUser, result.error);
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message ?? "请检查提交内容" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "发送失败" }, { status: 400 });
  }
}
