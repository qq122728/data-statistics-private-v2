import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../../lib/auth";
import { recordAudit } from "../../../../../lib/audit";
import { db } from "../../../../../lib/db";
import { hasAssignedRole } from "../../../../../lib/role-access";
import { authorizationDenied } from "../../../../../lib/security-events";

/**
 * 资源部对一条渠道核对记录的确认/异议动作（需求文档4.5）。校验风格照抄
 * historical-claims/review/route.ts 的 APPROVE/RETURN superRefine：确认无异议不需要
 * 理由，标记异议必须填写原因。确认是终态，不能撤销；异议之后组长可以重新发送同一天，
 * 那条记录会在 channel-review/route.ts 的 POST 里被重置回 SENT。
 */
const reviewSchema = z.object({
  decision: z.enum(["CONFIRM", "DISPUTE"]),
  note: z.string().trim().max(500, "异议原因不能超过 500 个字").optional(),
}).superRefine((value, context) => {
  if (value.decision === "DISPUTE" && !value.note)
    context.addIssue({ code: "custom", path: ["note"], message: "标记异议时必须填写原因" });
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !hasAssignedRole(actor, "RESOURCE_MANAGER"))
    return authorizationDenied(actor, "只有在职资源部账号可以处理核对记录");

  const allowedChannelIds = actor.resourceChannelAccess?.map((item) => item.channelId) ?? [];
  const { id } = await context.params;

  try {
    const input = reviewSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const entry = await tx.channelReviewEntry.findUnique({
        where: { id },
        select: { id: true, channelId: true, status: true },
      });
      // 不区分"不存在"和"不属于自己渠道范围"，跟 historical-claims/review 的跨组 404 一样，
      // 不向调用方泄露别的渠道确实有这条记录。
      if (!entry || !allowedChannelIds.includes(entry.channelId))
        return { status: 404 as const, error: "未找到待核对记录" };
      if (entry.status !== "SENT")
        return { status: 409 as const, error: "这条记录已经处理，请刷新列表" };

      const reviewedAt = new Date();
      if (input.decision === "CONFIRM") {
        await tx.channelReviewEntry.update({
          where: { id: entry.id },
          data: { status: "CONFIRMED", note: null, reviewedById: actor.id, reviewedAt },
        });
        await recordAudit(tx, { actorId: actor.id, action: "CHANNEL_REVIEW_CONFIRMED", entityType: "ChannelReviewEntry", entityId: entry.id, summary: {} });
        return { status: 200 as const, reviewStatus: "CONFIRMED" as const };
      }

      await tx.channelReviewEntry.update({
        where: { id: entry.id },
        data: { status: "DISPUTED", note: input.note, reviewedById: actor.id, reviewedAt },
      });
      await recordAudit(tx, { actorId: actor.id, action: "CHANNEL_REVIEW_DISPUTED", entityType: "ChannelReviewEntry", entityId: entry.id, summary: { note: input.note } });
      return { status: 200 as const, reviewStatus: "DISPUTED" as const };
    }, { isolationLevel: "Serializable" });

    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ reviewStatus: result.reviewStatus });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message ?? "请检查提交内容" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "处理失败" }, { status: 400 });
  }
}
