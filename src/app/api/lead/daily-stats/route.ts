import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import {
  DailyStatError,
  dailyStatEntryInclude,
  forwardDailyStatsToResource,
  publicDailyStat,
  reviewDailyStat,
} from "../../../../lib/daily-stats";
import { db } from "../../../../lib/db";
import { recordAudit } from "../../../../lib/audit";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied, type SecurityEventActor } from "../../../../lib/security-events";

const reviewSchema = z.object({
  entryId: z.string().trim().min(1),
  action: z.literal("RETURN"),
  reason: z.string().trim().max(500).nullable().optional(),
});

const forwardSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确"),
});

function errorResponse(error: unknown, actor?: SecurityEventActor) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (error instanceof DailyStatError) {
    if (error.status === 403) {
      if (!actor) throw error;
      return authorizationDenied(actor, error.message);
    }
    if (error.status === 401) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error.status === 404) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error.status === 409) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "请检查填写内容" }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  throw error;
}

async function requireLead(): Promise<{ actor: Awaited<ReturnType<typeof requireUser>> } | { response: ReturnType<typeof authorizationDenied> }> {
  const actor = await requireUser();
  if (!actor.groupId || !(hasAssignedRole(actor, "LEAD") || actor.duty === "LEAD")) {
    return { response: authorizationDenied(actor, "只有本组组长可以审核每日数据") };
  }
  return { actor };
}

export async function GET(request: Request) {
  let securityActor: SecurityEventActor | undefined;
  try {
    const access = await requireLead();
    if ("response" in access) return access.response;
    const actor = access.actor;
    securityActor = actor;
    const url = new URL(request.url);
    const status = url.searchParams.get("status")?.trim();
    const entries = await db.dailyStatEntry.findMany({
      where: {
        groupId: actor.groupId!,
        ...(status === "all" ? {} : { status: { in: ["PENDING", "CORRECTION_PENDING"] } }),
      },
      include: dailyStatEntryInclude,
      orderBy: [{ submittedAt: "asc" }, { businessDate: "desc" }],
      take: 300,
    });
    return NextResponse.json({ entries: entries.map(publicDailyStat) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error, securityActor);
  }
}

export async function PATCH(request: Request) {
  let securityActor: SecurityEventActor | undefined;
  try {
    const access = await requireLead();
    if ("response" in access) return access.response;
    const sessionUser = access.actor;
    securityActor = sessionUser;
    const input = reviewSchema.parse(await request.json());
    const entry = await db.$transaction(async (tx) => {
      const reviewer = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, duty: true },
      });
      if (!reviewer) throw new DailyStatError("账号不存在", 401);
      return reviewDailyStat(tx, reviewer, input);
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ entry: publicDailyStat(entry) });
  } catch (error) {
    return errorResponse(error, securityActor);
  }
}

export async function POST(request: Request) {
  let securityActor: SecurityEventActor | undefined;
  try {
    const access = await requireLead();
    if ("response" in access) return access.response;
    const sessionUser = access.actor;
    securityActor = sessionUser;
    const input = forwardSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const reviewer = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, duty: true },
      });
      if (!reviewer) throw new DailyStatError("账号不存在", 401);
      const forwarded = await forwardDailyStatsToResource(tx, reviewer, input.businessDate);
      await recordAudit(tx, {
        actorId: reviewer.id,
        action: "DAILY_STATS_FORWARDED_TO_RESOURCE",
        entityType: "DailyStatBusinessDate",
        entityId: `${reviewer.groupId}:${input.businessDate}`,
        summary: { groupId: reviewer.groupId, businessDate: input.businessDate, count: forwarded.count },
      });
      return forwarded;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, securityActor);
  }
}
