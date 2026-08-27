import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { standardsFromGroup, validateConversionStandards } from "../../../../lib/conversion-standards";
import { db } from "../../../../lib/db";
import { requireLeadRequest } from "../../../../lib/lead-members";

const standardSelect = {
  id: true,
  receptionJoinPassRate: true, receptionJoinGoodRate: true, receptionJoinExcellentRate: true,
  operatorExpertPassRate: true, operatorExpertGoodRate: true, operatorExpertExcellentRate: true,
  expertOrderPassRate: true, expertOrderGoodRate: true, expertOrderExcellentRate: true,
} as const;

export async function GET() {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const group = await db.teamGroup.findUnique({ where: { id: access.group.id }, select: standardSelect });
  if (!group) return NextResponse.json({ error: "没有找到所属小组" }, { status: 404 });
  return NextResponse.json({ standards: standardsFromGroup(group) });
}

export async function PATCH(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  const parsed = validateConversionStandards(body && typeof body === "object" ? (body as { standards?: unknown }).standards : null);
  if (!parsed.valid) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const result = await db.$transaction(async (client) => {
    const existing = await client.teamGroup.findUnique({ where: { id: access.group.id }, select: standardSelect });
    if (!existing) return null;
    const before = standardsFromGroup(existing);
    const after = parsed.standards;
    if (JSON.stringify(before) === JSON.stringify(after)) return { standards: before, unchanged: true };
    const updated = await client.teamGroup.update({
      where: { id: existing.id },
      data: {
        receptionJoinPassRate: after.receptionJoin.pass,
        receptionJoinGoodRate: after.receptionJoin.good,
        receptionJoinExcellentRate: after.receptionJoin.excellent,
        operatorExpertPassRate: after.operatorExpert.pass,
        operatorExpertGoodRate: after.operatorExpert.good,
        operatorExpertExcellentRate: after.operatorExpert.excellent,
        expertOrderPassRate: after.expertOrder.pass,
        expertOrderGoodRate: after.expertOrder.good,
        expertOrderExcellentRate: after.expertOrder.excellent,
      },
      select: standardSelect,
    });
    await recordAudit(client, {
      actorId: access.actor.id,
      action: "GROUP_CONVERSION_STANDARDS_UPDATED",
      entityType: "TeamGroup",
      entityId: existing.id,
      summary: { changedFields: ["conversionStandards"], before, after },
    });
    return { standards: standardsFromGroup(updated), unchanged: false };
  });
  if (!result) return NextResponse.json({ error: "没有找到所属小组" }, { status: 404 });
  return NextResponse.json(result);
}
