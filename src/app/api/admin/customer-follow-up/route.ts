import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "../../../../lib/audit";
import { statisticsDate } from "../../../../lib/statistics-date";
import { db } from "../../../../lib/db";
import { getSystemSettings } from "../../../../lib/settings";
import { requireAdminRequest } from "../_auth";
import { API_LIMITS } from "../../../../lib/request-limits";

const updatePlanSchema = z
  .object({
    leadId: z.string().min(1).max(API_LIMITS.identifierCharacters),
    nextPlan: z.string().trim().max(300).nullable(),
    nextFollowUpOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .strict();

export async function PATCH(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;

  const parsed = updatePlanSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "跟进计划参数不正确" }, { status: 400 });
  }
  const nextPlan = parsed.data.nextPlan?.trim() || null;
  const nextFollowUpOn = parsed.data.nextFollowUpOn || null;
  const settings = await getSystemSettings();
  const occurredOn = statisticsDate();

  const result = await db.$transaction(async (client) => {
    const existing = await client.leadCustomer.findUnique({
      where: { id: parsed.data.leadId },
      select: {
        id: true,
        phone: true,
        nextPlan: true,
        nextFollowUpOn: true,
      },
    });
    if (!existing) return null;

    if (
      existing.nextPlan === nextPlan &&
      existing.nextFollowUpOn === nextFollowUpOn
    ) {
      return existing;
    }

    const updated = await client.leadCustomer.update({
      where: { id: existing.id },
      data: { nextPlan, nextFollowUpOn },
      select: {
        id: true,
        phone: true,
        nextPlan: true,
        nextFollowUpOn: true,
      },
    });
    const note = [
      nextPlan ? `下一步：${nextPlan}` : "已清除手动计划",
      nextFollowUpOn ? `计划日期：${nextFollowUpOn}` : null,
    ]
      .filter(Boolean)
      .join("；");
    await client.leadActivity.create({
      data: {
        leadId: existing.id,
        actorId: access.actor.id,
        kind: "PLAN_UPDATED",
        occurredOn,
        note,
      },
    });
    await recordAudit(client, {
      actorId: access.actor.id,
      action: "CUSTOMER_PLAN_UPDATED",
      entityType: "LeadCustomer",
      entityId: existing.id,
      summary: {
        phone: existing.phone,
        before: {
          nextPlan: existing.nextPlan,
          nextFollowUpOn: existing.nextFollowUpOn,
        },
        after: { nextPlan, nextFollowUpOn },
      },
    });
    return updated;
  });

  if (!result) {
    return NextResponse.json({ error: "客户不存在或已删除" }, { status: 404 });
  }
  return NextResponse.json(result);
}
