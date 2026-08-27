import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { InvalidFanReportError, reviewInvalidFanReport } from "../../../../lib/invalid-fan-reports";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const reviewSchema = z.object({
  action: z.enum(["approve", "return"]),
  noWsCount: z.number().int().min(0).optional(),
  lowAmountCount: z.number().int().min(0).optional(),
  collisionCount: z.number().int().min(0).optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ reportId: string }> }) {
  let user = null;
  try {
    user = await requireUser();
    const input = reviewSchema.parse(await request.json());
    const { reportId } = await context.params;
    if (reportId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "无效粉审核参数过长" }, { status: 400 });
    const hasAllCounts = input.noWsCount !== undefined && input.lowAmountCount !== undefined && input.collisionCount !== undefined;
    const report = await reviewInvalidFanReport({
      actor: user,
      reportId,
      action: input.action,
      ...(hasAllCounts ? { approvedCounts: { noWsCount: input.noWsCount!, lowAmountCount: input.lowAmountCount!, collisionCount: input.collisionCount! } } : {}),
      reason: input.reason,
    });
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof InvalidFanReportError) {
      if (error.status === 403) {
        if (!user) throw error;
        return authorizationDenied(user, error.message);
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) return NextResponse.json({ error: "请检查无效粉审核内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
