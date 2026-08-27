import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import {
  createInvalidFanReport,
  createLeaderInvalidFanSupplement,
  InvalidFanReportError,
  resolveInvalidFanReportBatch,
} from "../../../lib/invalid-fan-reports";
import { db } from "../../../lib/db";
import { isCalendarDate } from "../../../lib/dates";
import { hasAssignedRole } from "../../../lib/role-access";
import { API_LIMITS } from "../../../lib/request-limits";
import { authorizationDenied, type SecurityEventActor } from "../../../lib/security-events";
import { resolveReadableReportGroups } from "../../../lib/report-scope";

const counts = z.object({
  noWsCount: z.number().int().min(0),
  lowAmountCount: z.number().int().min(0),
  collisionCount: z.number().int().min(0),
});

const createSchema = z.object({
  batchId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  channelId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  sourceDate: z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD").optional(),
  action: z.enum(["report", "supplement"]).default("report"),
  reason: z.string().trim().max(300).optional(),
}).merge(counts).superRefine((input, context) => {
  const hasBatch = Boolean(input.batchId);
  const hasChannelAndDate = Boolean(input.channelId && input.sourceDate);
  if (hasBatch === hasChannelAndDate) {
    context.addIssue({ code: "custom", path: ["batchId"], message: "请选择来源批次，或同时填写渠道和日期" });
  }
});

function errorResponse(error: unknown, actor: SecurityEventActor | null = null) {
  if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof InvalidFanReportError) {
    if (error.status === 403) {
      if (!actor) throw error;
      return authorizationDenied(actor, error.message);
    }
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) return NextResponse.json({ error: "三个无效粉数量必须是大于或等于 0 的整数" }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  throw error;
}

export async function GET() {
  let user = null;
  try {
    user = await requireUser();
    const readableGroupIds = user.role === "COMPANY_MANAGER"
      ? resolveReadableReportGroups(user, await db.teamGroup.findMany({ select: { id: true, departmentId: true, countryCode: true, department: { select: { countryCode: true } } } })).map((group) => group.id)
      : [];
    const where = hasAssignedRole(user, "RECEPTION")
      ? { reporterId: user.id }
      : user.role === "LEAD" && user.groupId
        ? { batch: { groupId: user.groupId } }
        : user.role === "COMPANY_MANAGER"
          ? { batch: { groupId: { in: readableGroupIds } } }
          : user.role === "RESOURCE_MANAGER"
          ? { batch: { channelId: { in: user.resourceChannelAccess?.map((access) => access.channelId) ?? [] } } }
          : user.role === "ADMIN" || user.role === "FINANCE"
          ? {}
          : null;
    if (!where) return authorizationDenied(user, "没有查看无效粉数据的权限");
    const reports = await db.invalidFanReport.findMany({
      where,
      select: {
        id: true, status: true, noWsCount: true, lowAmountCount: true, collisionCount: true,
        approvedNoWsCount: true, approvedLowAmountCount: true, approvedCollisionCount: true,
        reviewReason: true, reviewedAt: true, isLeaderSupplement: true, createdAt: true, updatedAt: true,
        batch: { select: { id: true, sourceDate: true, groupId: true, channel: { select: { id: true, name: true } } } },
        reporter: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        audits: { select: { id: true, action: true, reason: true, createdAt: true, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
    });
    return NextResponse.json({ reports });
  } catch (error) {
    return errorResponse(error, user);
  }
}

export async function POST(request: Request) {
  let user = null;
  try {
    user = await requireUser();
    const input = createSchema.parse(await request.json());
    const countsInput = { noWsCount: input.noWsCount, lowAmountCount: input.lowAmountCount, collisionCount: input.collisionCount };
    const batchId = input.batchId ?? await resolveInvalidFanReportBatch({
      actor: user,
      channelId: input.channelId!,
      sourceDate: input.sourceDate!,
    });
    const report = input.action === "supplement"
      ? await createLeaderInvalidFanSupplement({ actor: user, batchId, counts: countsInput, reason: input.reason ?? "" })
      : await createInvalidFanReport({ actor: user, batchId, counts: countsInput });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    return errorResponse(error, user);
  }
}
