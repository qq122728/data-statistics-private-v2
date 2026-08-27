import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "../../../../lib/audit";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { isCalendarDate, localDateYYYYMMDD } from "../../../../lib/dates";
import { entryDateError } from "../../../../lib/entry-date-validation";
import { getSystemSettings } from "../../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../../lib/business-time";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const inputSchema = z.object({
  channelId: z.string().min(1, "请选择投流渠道").max(API_LIMITS.identifierCharacters),
  sourceDate: z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD"),
  advertisingSpendCents: z.number().int().positive("广告费必须大于 0"),
});

/** 组长先建立一笔共享投流批次，再让多位接粉员共同导入。 */
export async function POST(request: Request) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!user.active || user.role !== "LEAD" || !user.groupId)
    return authorizationDenied(user, "只有本组组长可以建立投流批次");

  try {
    const input = inputSchema.parse(await request.json());
    const settings = await getSystemSettings();
    const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
    const dateError = entryDateError(input.sourceDate, today, "投放日期");
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

    const result = await db.$transaction(async (client) => {
      const channel = await client.channel.findFirst({
        where: { id: input.channelId, groupId: user.groupId!, active: true, channelType: "ADS" },
        select: { id: true, name: true, fanCostMode: true, rebateRateBps: true },
      });
      if (!channel) return { error: "请选择本组启用中的投流渠道", status: 400 as const };

      const existing = await client.sourceBatch.findUnique({
        where: { groupId_channelId_sourceDate: { groupId: user.groupId!, channelId: channel.id, sourceDate: input.sourceDate } },
        select: { id: true },
      });
      if (existing) return { error: "该渠道和日期的投流批次已建立；请让接粉员继续选择同一渠道和日期导入", status: 409 as const };

      const batch = await client.sourceBatch.create({
        data: {
          groupId: user.groupId!,
          channelId: channel.id,
          sourceDate: input.sourceDate,
          fanCostModeSnapshot: channel.fanCostMode,
          channelTypeSnapshot: "ADS",
          rebateRateBpsSnapshot: channel.rebateRateBps,
          advertisingSpendCents: input.advertisingSpendCents,
          advertisingFanCount: 0,
          advertisingServiceFeeRateBps: 1_500,
          effectiveFanPriceCentsSnapshot: null,
        },
      });
      await recordAudit(client, {
        actorId: user.id,
        action: "ADS_SHARED_BATCH_CREATED",
        entityType: "SourceBatch",
        entityId: batch.id,
        summary: {
          groupId: user.groupId,
          channelName: channel.name,
          sourceDate: input.sourceDate,
          advertisingSpendCents: input.advertisingSpendCents,
          note: "共享投流批次已建立，等待接粉员导入有效新号码后自动核算统一单粉成本",
        },
      });
      return { batch, channelName: channel.name };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
