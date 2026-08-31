import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { leadCurrentGroupId } from "../../../../lib/customer-current-group";

const inputSchema = z.object({
  leadId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  expertOwnerId: z.string().min(1).max(API_LIMITS.identifierCharacters).nullable(),
}).strict();

export async function PATCH(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (user.role !== "LEAD" || !user.groupId)
    return authorizationDenied(user, "只有组长可以分配专家客户");

  try {
    const input = inputSchema.parse(await request.json());
    const result = await db.$transaction(async (transaction) => {
      const lead = await transaction.leadCustomer.findUnique({
        where: { id: input.leadId },
        select: {
          id: true,
          phone: true,
          expertIntroducedOn: true,
          currentGroupId: true,
          batch: { select: { groupId: true } },
        },
      });
      if (!lead || leadCurrentGroupId(lead) !== user.groupId)
        return { status: 404 as const, error: "本组没有这个客户" };
      if (!lead.expertIntroducedOn)
        return { status: 400 as const, error: "客户推专家后才能分配" };

      let assignee: { id: string; name: string } | null = null;
      if (input.expertOwnerId) {
        assignee = await transaction.user.findFirst({
          where: {
            id: input.expertOwnerId,
            groupId: user.groupId,
            active: true,
            OR: [{ role: { in: ["LEAD", "EXPERT"] } }, { roleAssignments: { some: { role: "EXPERT" } } }],
          },
          select: { id: true, name: true },
        });
        if (!assignee)
          return { status: 400 as const, error: "只能分配给本组组长或在职前台专家" };
      }

      await transaction.leadCustomer.update({
        where: { id: lead.id },
        data: { expertOwnerId: assignee?.id ?? null },
      });
      await transaction.auditLog.create({
        data: {
          actorId: user.id,
          action: "EXPERT_CUSTOMER_ASSIGNED",
          entityType: "LeadCustomer",
          entityId: lead.id,
          summary: assignee
            ? `${lead.phone} 分配给专家负责人 ${assignee.name}`
            : `${lead.phone} 取消专家负责人`,
        },
      });
      return { status: 200 as const, assignee };
    });

    if ("error" in result)
      return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ saved: true, expertOwner: result.assignee });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message ?? "请检查分配内容" }, { status: 400 });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
