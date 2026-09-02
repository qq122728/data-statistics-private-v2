import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../../../lib/auth";
import { recordAudit } from "../../../../../../lib/audit";
import { reattributeCustomerNumberEvents } from "../../../../../../lib/customer-number-event-sync";
import { leadCurrentGroupId } from "../../../../../../lib/customer-current-group";
import { db, getOrCreateSourceBatch } from "../../../../../../lib/db";
import { entryDateError } from "../../../../../../lib/entry-date-validation";
import { API_LIMITS } from "../../../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../../../lib/role-access";
import { authorizationDenied } from "../../../../../../lib/security-events";
import { statisticsDate } from "../../../../../../lib/statistics-date";

const correctionSchema = z.object({
  attributionOwnerId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  channelId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择接粉日期"),
  reason: z
    .string()
    .trim()
    .min(2, "请填写至少 2 个字的纠错原因")
    .max(300, "纠错原因不能超过 300 个字"),
});

/**
 * 原始归属纠错专用入口。
 * 组长说明原因后可以完整纠正接粉人、来源渠道和接粉日期；接粉成员只能修改
 * 自己名下客户的来源渠道。同时把已经产生的进群、推专家、注册和开单统计
 * 搬到正确归属，并留下完整审计。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let sessionUser;
  try {
    sessionUser = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (
    !sessionUser.active ||
    !sessionUser.groupId ||
    (!hasAssignedRole(sessionUser, "LEAD") && !hasAssignedRole(sessionUser, "RECEPTION"))
  )
    return authorizationDenied(sessionUser, "只有本组组长或接粉成员可以修改客户来源渠道");

  try {
    const input = correctionSchema.parse(await request.json());
    const { leadId } = await params;
    if (leadId.length > API_LIMITS.identifierCharacters)
      return NextResponse.json({ error: "客户参数过长" }, { status: 400 });

    const result = await db.$transaction(async (transaction) => {
      const actor = await transaction.user.findUnique({
        where: { id: sessionUser.id },
        select: {
          id: true,
          active: true,
          groupId: true,
          role: true,
          roleAssignments: { select: { role: true } },
        },
      });
      const lead = await transaction.leadCustomer.findUnique({
        where: { id: leadId },
        include: {
          batch: { select: { groupId: true, channelId: true, sourceDate: true } },
          customerOrder: { select: { openedOn: true, voidedAt: true } },
        },
      });
      const actorIsLead = Boolean(actor && hasAssignedRole(actor, "LEAD"));
      const actorIsReception = Boolean(actor && hasAssignedRole(actor, "RECEPTION"));
      if (!actor?.active || !actor.groupId || (!actorIsLead && !actorIsReception))
        return { status: 403 as const, error: "修改权限已失效，请重新登录" };
      if (!lead || lead.trackingArchivedAt || leadCurrentGroupId(lead) !== actor.groupId)
        return { status: 404 as const, error: "客户不存在或已不在本组" };

      const currentAttributionOwnerId = lead.attributionOwnerId ?? lead.ownerId;
      if (!actorIsLead) {
        if (currentAttributionOwnerId !== actor.id)
          return { status: 403 as const, error: "接粉成员只能修改自己名下客户的来源渠道" };
        if (
          input.attributionOwnerId !== currentAttributionOwnerId ||
          input.sourceDate !== lead.batch.sourceDate
        )
          return { status: 403 as const, error: "接粉成员不能修改接粉人或接粉日期" };
      }

      const today = statisticsDate();
      const dateError = entryDateError(input.sourceDate, today, "接粉日期");
      if (dateError) return { status: 400 as const, error: dateError };
      if (lead.joinedOn && input.sourceDate > lead.joinedOn)
        return { status: 400 as const, error: "接粉日期不能晚于进群日期" };

      const [owner, channel] = await Promise.all([
        transaction.user.findFirst({
          where: {
            id: input.attributionOwnerId,
            groupId: actor.groupId,
            active: true,
            OR: [
              { role: "RECEPTION" },
              { roleAssignments: { some: { role: "RECEPTION" } } },
            ],
          },
          select: { id: true, name: true },
        }),
        transaction.channel.findUnique({
          where: { id_groupId: { id: input.channelId, groupId: actor.groupId } },
          select: { id: true, name: true, active: true },
        }),
      ]);
      if (!owner)
        return { status: 400 as const, error: "接粉归属只能选择本组有接粉权限的在职成员" };
      if (!channel?.active)
        return { status: 400 as const, error: "来源渠道不存在或已停用" };

      const batch = await getOrCreateSourceBatch(
        { groupId: actor.groupId, channelId: channel.id, sourceDate: input.sourceDate },
        transaction,
      );
      const before = {
        ...lead,
        batch: { groupId: actor.groupId, channelId: lead.batch.channelId },
      };
      const after = {
        ...lead,
        ownerId: owner.id,
        attributionOwnerId: owner.id,
        batch: { groupId: actor.groupId, channelId: channel.id },
      };

      const changed =
        (lead.attributionOwnerId ?? lead.ownerId) !== owner.id ||
        lead.batch.channelId !== channel.id ||
        lead.batch.sourceDate !== input.sourceDate;
      if (!changed)
        return { status: 400 as const, error: "归属信息没有变化，无需纠错" };

      await transaction.leadCustomer.update({
        where: { id: lead.id },
        data: { ownerId: owner.id, attributionOwnerId: owner.id, batchId: batch.id },
      });
      await reattributeCustomerNumberEvents(transaction, before, after);
      await transaction.leadActivity.create({
        data: {
          leadId: lead.id,
          actorId: actor.id,
          kind: "PLAN_UPDATED",
          occurredOn: today,
          note: `${actorIsLead ? "组长纠正原始归属" : "接粉修改来源渠道"}：接粉人 ${owner.name}，渠道 ${channel.name}，接粉日期 ${input.sourceDate}。原因：${input.reason}`,
        },
      });
      await recordAudit(transaction, {
        actorId: actor.id,
        action: "CUSTOMER_ATTRIBUTION_CORRECTED",
        entityType: "LeadCustomer",
        entityId: lead.id,
        summary: {
          reason: input.reason,
          before: {
            attributionOwnerId: lead.attributionOwnerId ?? lead.ownerId,
            channelId: lead.batch.channelId,
            sourceDate: lead.batch.sourceDate,
          },
          after: {
            attributionOwnerId: owner.id,
            channelId: channel.id,
            sourceDate: input.sourceDate,
          },
        },
      });
      return { status: 200 as const };
    });

    if ("error" in result)
      return result.status === 403
        ? authorizationDenied(sessionUser, result.error)
        : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ saved: true });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "请检查纠错内容" },
        { status: 400 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
