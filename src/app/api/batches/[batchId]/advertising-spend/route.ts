import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "../../../../../lib/audit";
import { AuthenticationError, requireUser } from "../../../../../lib/auth";
import { db } from "../../../../../lib/db";
import { API_LIMITS } from "../../../../../lib/request-limits";
import { authorizationDenied } from "../../../../../lib/security-events";

const inputSchema = z.object({
  advertisingSpendCents: z.number().int().positive("广告消耗必须大于 0"),
  correctionReason: z.string().trim().max(300, "更正说明不能超过 300 个字").optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!user.active || user.role !== "LEAD" || !user.groupId)
    return authorizationDenied(user, "只有本组组长可以填写投流广告消耗");
  const groupId = user.groupId;

  try {
    const input = inputSchema.parse(await request.json());
    const { batchId } = await params;
    if (batchId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "批次参数过长" }, { status: 400 });
    const result = await db.$transaction(async (client) => {
      const batch = await client.sourceBatch.findFirst({
        where: { id: batchId, groupId },
        select: {
          id: true,
          groupId: true,
          channelTypeSnapshot: true,
          advertisingSpendCents: true,
          advertisingFanCount: true,
          advertisingServiceFeeRateBps: true,
          effectiveFanPriceCentsSnapshot: true,
        },
      });
      if (!batch) return { error: "没有找到本组的这个批次", status: 404 as const };
      if (batch.channelTypeSnapshot !== "ADS") return { error: "只有投流批次可以填写广告消耗", status: 400 as const };
      if (batch.advertisingSpendCents !== null && !input.correctionReason)
        return { error: "这批广告消耗已填写；如需更正，请填写更正说明", status: 400 as const };

      const imported = await client.metricEvent.aggregate({
        where: { batchId, kind: "EFFECTIVE_FANS", derivedFromLedger: true, voidedAt: null },
        _sum: { quantity: true },
      });
      // 新的共享投流批次允许先填广告费、再由多位接粉员陆续导入。
      // 历史批次没有逐笔导入事件时，继续使用原先保存的人数快照。
      const importedCount = imported._sum.quantity ?? 0;
      const fanCount = importedCount > 0 ? importedCount : (batch.advertisingFanCount ?? 0);

      const serviceFeeRateBps = batch.advertisingServiceFeeRateBps ?? 1_500;
      const effectiveFanPriceCents = fanCount > 0
        ? Math.round(input.advertisingSpendCents * (1 + serviceFeeRateBps / 10_000) / fanCount)
        : null;
      const updated = await client.sourceBatch.update({
        where: { id: batch.id },
        data: {
          advertisingSpendCents: input.advertisingSpendCents,
          advertisingFanCount: fanCount,
          advertisingServiceFeeRateBps: serviceFeeRateBps,
          effectiveFanPriceCentsSnapshot: effectiveFanPriceCents,
        },
        select: {
          id: true,
          advertisingSpendCents: true,
          advertisingFanCount: true,
          advertisingServiceFeeRateBps: true,
          effectiveFanPriceCentsSnapshot: true,
        },
      });
      await recordAudit(client, {
        actorId: user.id,
        action: batch.advertisingSpendCents === null ? "ADS_BATCH_SPEND_FILLED" : "ADS_BATCH_SPEND_CORRECTED",
        entityType: "SourceBatch",
        entityId: batch.id,
        summary: {
          groupId: batch.groupId,
          correctionReason: input.correctionReason ?? null,
          before: {
            advertisingSpendCents: batch.advertisingSpendCents,
            advertisingFanCount: batch.advertisingFanCount,
            advertisingServiceFeeRateBps: batch.advertisingServiceFeeRateBps,
            effectiveFanPriceCentsSnapshot: batch.effectiveFanPriceCentsSnapshot,
          },
          after: updated,
        },
      });
      return { batch: updated };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.batch);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
