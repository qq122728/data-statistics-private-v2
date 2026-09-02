import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "../../../../../lib/audit";
import { dailyStatEntryInclude, isUnifiedDailyStatIdentity, publicDailyStat } from "../../../../../lib/daily-stats";
import { db } from "../../../../../lib/db";
import { requireLeadRequest } from "../../../../../lib/lead-members";
import { API_LIMITS, hasOversizedQueryValue } from "../../../../../lib/request-limits";
import { NUMBER_TRACKED_DAILY_FIELDS } from "../../../../../lib/customer-number-tracking";

type RouteContext = { params: Promise<{ memberId: string }> };

const correctionSchema = z.object({
  entryId: z.string().trim().min(1).max(API_LIMITS.identifierCharacters),
  field: z.enum([
    "dispatchCount", "duplicateCount", "lowAmountCount", "noWsCount", "manualInvalidCount",
    "replyCount", "joinCount", "normalLeaveCount", "abnormalLeaveCount", "expertIntroCount",
    "registrationCount", "orderCount", "cryptoInitialDepositCents", "bankInitialDepositCents",
    "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents",
  ]),
  value: z.number().int().min(0).max(2_147_483_647),
  reason: z.string().trim().min(4, "修改原因至少填写 4 个字").max(500),
});

const receptionFields = new Set(["dispatchCount", "duplicateCount", "lowAmountCount", "noWsCount", "manualInvalidCount", "replyCount", "joinCount"]);
const groupFields = new Set(["operatorReceivedCount", "normalLeaveCount", "abnormalLeaveCount", "expertIntroCount"]);
const expertFields = new Set(["registrationCount", "orderCount", "cryptoInitialDepositCents", "bankInitialDepositCents", "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents"]);
const unifiedReceptionFields = new Set([...receptionFields, ...groupFields, ...expertFields]);

function fieldAllowed(position: string, identityKey: string, field: string) {
  return position === "RECEPTION" ? (isUnifiedDailyStatIdentity(identityKey) ? unifiedReceptionFields : receptionFields).has(field)
    : position === "GROUP_OPERATOR" ? groupFields.has(field)
      : position === "EXPERT" ? expertFields.has(field)
        : false;
}

function revisionSnapshot(revision: Record<string, unknown>) {
  return {
    dispatchCount: revision.dispatchCount as number,
    duplicateCount: revision.duplicateCount as number,
    lowAmountCount: revision.lowAmountCount as number,
    noWsCount: revision.noWsCount as number,
    manualInvalidCount: revision.manualInvalidCount as number,
    effectiveCount: revision.effectiveCount as number,
    replyCount: revision.replyCount as number,
    joinCount: revision.joinCount as number,
    operatorReceivedCount: revision.operatorReceivedCount as number,
    normalLeaveCount: revision.normalLeaveCount as number,
    abnormalLeaveCount: revision.abnormalLeaveCount as number,
    currentInGroupCount: revision.currentInGroupCount as number,
    expertIntroCount: revision.expertIntroCount as number,
    expertReceivedCount: revision.expertReceivedCount as number,
    expertContactedCount: revision.expertContactedCount as number,
    registrationCount: revision.registrationCount as number,
    orderCount: revision.orderCount as number,
    cryptoInitialDepositCents: revision.cryptoInitialDepositCents as number,
    bankInitialDepositCents: revision.bankInitialDepositCents as number,
    cryptoRechargeCents: revision.cryptoRechargeCents as number,
    bankRechargeCents: revision.bankRechargeCents as number,
    withdrawalCents: revision.withdrawalCents as number,
  };
}

async function memberInGroup(memberId: string, groupId: string) {
  return db.user.findFirst({
    where: {
      id: memberId,
      OR: [
        { groupId },
        { positionHistory: { some: { groupId } } },
        { membershipHistory: { some: { groupId } } },
      ],
    },
    select: { id: true, name: true, active: true },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const { memberId } = await context.params;
  if (memberId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "成员参数过长" }, { status: 400 });
  const member = await memberInGroup(memberId, access.group.id);
  if (!member) return NextResponse.json({ error: "成员不存在或不属于本组" }, { status: 404 });

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const from = params.get("from")?.trim() || undefined;
  const to = params.get("to")?.trim() || undefined;
  const validDate = (value?: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!validDate(from) || !validDate(to) || (from && to && from > to)) return NextResponse.json({ error: "日期范围不正确" }, { status: 400 });

  const entries = await db.dailyStatEntry.findMany({
    where: {
      OR: [{ ownerId: member.id }, { sourceReceptionId: member.id }],
      groupId: access.group.id,
      ...(from || to ? { businessDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    include: {
      ...dailyStatEntryInclude,
      revisions: {
        orderBy: { version: "desc" },
        take: 20,
        include: { createdBy: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ businessDate: "desc" }, { channel: { name: "asc" } }, { position: "asc" }],
    take: 500,
  });
  return NextResponse.json({
    member,
    group: access.group,
    entries: entries.map((entry) => ({ ...publicDailyStat(entry), revisions: entry.revisions })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const { memberId } = await context.params;
  try {
    const input = correctionSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const member = await tx.user.findFirst({
        where: { id: memberId, OR: [{ groupId: access.group.id }, { positionHistory: { some: { groupId: access.group.id } } }, { membershipHistory: { some: { groupId: access.group.id } } }] },
        select: { id: true, name: true },
      });
      if (!member) return { error: "成员不存在或不属于本组", status: 404 as const };
      const entry = await tx.dailyStatEntry.findFirst({
        where: {
          id: input.entryId,
          groupId: access.group.id,
          OR: [{ ownerId: member.id }, { sourceReceptionId: member.id }],
        },
        include: { currentRevision: true, revisions: { orderBy: { version: "desc" }, take: 1 } },
      });
      if (!entry?.currentRevision) return { error: "未找到可以纠正的原始记录", status: 404 as const };
      if (!fieldAllowed(entry.position, entry.identityKey, input.field)) return { error: "该项目不属于这条岗位记录，不能直接修改", status: 400 as const };
      if (
        access.group.groupType === "HACKER" &&
        NUMBER_TRACKED_DAILY_FIELDS.includes(input.field as (typeof NUMBER_TRACKED_DAILY_FIELDS)[number])
      ) return { error: "进群及后续数据必须回客户号码进度纠正，不能直接修改数量", status: 400 as const };

      const before = (entry.currentRevision as unknown as Record<string, unknown>)[input.field] as number;
      const values = revisionSnapshot(entry.currentRevision as unknown as Record<string, unknown>);
      (values as unknown as Record<string, number>)[input.field] = input.value;
      if (entry.position === "RECEPTION") {
        values.effectiveCount = values.dispatchCount - values.duplicateCount - values.lowAmountCount - values.noWsCount - values.manualInvalidCount;
        if (isUnifiedDailyStatIdentity(entry.identityKey)) {
          values.currentInGroupCount = Math.max(0, values.joinCount - values.normalLeaveCount - values.abnormalLeaveCount);
        }
      }
      if (entry.position === "GROUP_OPERATOR") {
        values.currentInGroupCount = Math.max(0, values.operatorReceivedCount - values.normalLeaveCount - values.abnormalLeaveCount);
      }
      const revision = await tx.dailyStatRevision.create({
        data: {
          entryId: entry.id,
          version: (entry.revisions[0]?.version ?? 0) + 1,
          createdById: access.actor.id,
          changeReason: input.reason,
          ...values,
        },
      });
      const updated = await tx.dailyStatEntry.update({
        where: { id: entry.id },
        data: {
          currentRevisionId: revision.id,
          approvedRevisionId: revision.id,
          status: "APPROVED",
          submittedAt: new Date(),
          reviewedById: access.actor.id,
          reviewedAt: new Date(),
          reviewReason: input.reason,
        },
        include: dailyStatEntryInclude,
      });
      await recordAudit(tx, {
        actorId: access.actor.id,
        action: "DAILY_STAT_LEAD_CORRECTED",
        entityType: "DailyStatEntry",
        entityId: entry.id,
        summary: { memberId: member.id, memberName: member.name, businessDate: entry.businessDate, channelId: entry.channelId, position: entry.position, field: input.field, before, after: input.value, reason: input.reason, revisionVersion: revision.version },
      });
      return { entry: publicDailyStat(updated) };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "请检查修改内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
