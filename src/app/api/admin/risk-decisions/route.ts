import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { requireAdminRequest } from "../_auth";
import { API_LIMITS } from "../../../../lib/request-limits";

type DecisionRequest = {
  memberId?: unknown;
  level?: unknown;
  evidenceThrough?: unknown;
  reason?: unknown;
};

const levels = ["LIMIT_WATCH", "ELIMINATION_WATCH"] as const;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function POST(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;

  let body: DecisionRequest;
  try {
    body = await request.json() as DecisionRequest;
  } catch {
    return NextResponse.json({ error: "人工确认参数不正确" }, { status: 400 });
  }
  const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
  const level = typeof body.level === "string" && levels.includes(body.level as typeof levels[number])
    ? body.level as typeof levels[number]
    : null;
  const evidenceThrough = typeof body.evidenceThrough === "string" ? body.evidenceThrough.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!memberId || memberId.length > API_LIMITS.identifierCharacters || !level || !isRealDate(evidenceThrough)) {
    return NextResponse.json({ error: "人工确认参数不正确" }, { status: 400 });
  }
  if (reason.length < 4 || reason.length > API_LIMITS.accountReasonCharacters) {
    return NextResponse.json({ error: "人工确认原因必须在 4 到 500 个字之间" }, { status: 400 });
  }

  const latestDecision = await db.$transaction(async (client) => {
    const member = await client.user.findFirst({
      where: { id: memberId, role: { in: ["LEAD", "RECEPTION"] } },
      select: { id: true, name: true, role: true },
    });
    if (!member) return null;
    const decision = await client.riskDecision.create({
      data: { memberId, actorId: access.actor.id, level, evidenceThrough, reason },
    });
    await recordAudit(client, {
      actorId: access.actor.id,
      action: "RISK_DECISION_CREATED",
      entityType: "RiskDecision",
      entityId: decision.id,
      summary: { memberId, memberName: member.name, memberRole: member.role, level, evidenceThrough, reason },
    });
    return decision;
  });

  if (!latestDecision) {
    return NextResponse.json({ error: "只能为组长或成员做人工风险确认" }, { status: 400 });
  }
  return NextResponse.json({ latestDecision }, { status: 201 });
}
