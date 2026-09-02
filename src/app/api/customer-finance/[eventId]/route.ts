import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { canWriteCustomerFinance, financeScopeError, financeWriteRoles } from "../../../../lib/customer-finance-access";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const correctionSchema = z.object({
  action: z.literal("void"),
  reason: z.string().trim().min(1, "请填写纠错原因").max(100),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!financeWriteRoles.includes(user.role as (typeof financeWriteRoles)[number]))
    return authorizationDenied(user, "当前岗位不能作废资金流水");
  try {
    const input = correctionSchema.parse(await request.json());
    const { eventId } = await params;
    if (eventId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "流水参数过长" }, { status: 400 });
    const result = await db.$transaction(async (transaction) => {
      const event = await transaction.customerFinanceEvent.findUnique({
        where: { id: eventId },
        include: {
          customerOrder: {
            select: {
              phone: true,
              batch: { select: { groupId: true, channelId: true } },
              lead: { select: { ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true, currentGroupId: true, trackingArchivedAt: true } },
            },
          },
        },
      });
      if (!event || !event.customerOrder || !["RECHARGE", "WITHDRAWAL"].includes(event.kind)) return { status: 404 as const, error: "资金流水不存在" };
      if (event.customerOrder.lead?.trackingArchivedAt) return { status: 404 as const, error: "该客户已经封存" };
      if (event.kind === "RECHARGE" && event.continuationNumber === null) return { status: 400 as const, error: "首充请通过“作废开单”纠错" };
      if (!canWriteCustomerFinance(user, event.customerOrder)) return { status: 403 as const, error: financeScopeError(user.role) };
      if (event.voidedAt) return { status: 400 as const, error: "该资金流水已经作废" };
      const updated = await transaction.customerFinanceEvent.update({ where: { id: event.id }, data: { voidedAt: new Date(), voidReason: input.reason, voidedById: user.id } });
      return { status: 200 as const, event: updated };
    });
    if ("error" in result) return result.status === 403
      ? authorizationDenied(user, result.error)
      : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ event: result.event });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
