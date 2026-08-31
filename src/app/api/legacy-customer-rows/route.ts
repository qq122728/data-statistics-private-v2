import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { db } from "../../../lib/db";
import { isFrontlineGroupMember } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";

async function sessionActor() {
  try {
    return { actor: await requireUser(), error: null } as const;
  } catch (error) {
    if (error instanceof AuthenticationError)
      return { actor: null, error: NextResponse.json({ error: "请先登录" }, { status: 401 }) } as const;
    throw error;
  }
}

function serialize(row: {
  id: string;
  joinedOn: string | null;
  phone: string;
  attributionMemberName: string;
  sourceChannelName: string;
  groupOperatorName: string;
  deviceCode: string;
  groupSituation: string;
  leaveType: string;
  leftOn: string | null;
  expertName: string;
  expertSituation: string;
  registeredOn: string | null;
  initialDepositCents: number;
  rechargeCents: number;
  withdrawalCents: number;
  updatedAt: Date;
}) {
  return {
    ...row,
    initialDeposit: (row.initialDepositCents / 100).toFixed(2),
    recharge: (row.rechargeCents / 100).toFixed(2),
    withdrawal: (row.withdrawalCents / 100).toFixed(2),
    netPerformanceCents: row.initialDepositCents + row.rechargeCents - row.withdrawalCents,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  const session = await sessionActor();
  if (session.error) return session.error;
  const actor = session.actor;
  if (!actor.active || !actor.groupId || !isFrontlineGroupMember(actor))
    return authorizationDenied(actor, "当前账号不能查看老客户导入表");

  const rows = await db.legacyCustomerRow.findMany({
    where: { groupId: actor.groupId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  return NextResponse.json({ rows: rows.map(serialize) });
}

export async function POST() {
  const session = await sessionActor();
  if (session.error) return session.error;
  const actor = session.actor;
  if (!actor.active || !actor.groupId || !isFrontlineGroupMember(actor))
    return authorizationDenied(actor, "当前账号不能新增老客户");

  const row = await db.$transaction(async (tx) => {
    const created = await tx.legacyCustomerRow.create({
      data: { groupId: actor.groupId!, createdById: actor.id, updatedById: actor.id },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "LEGACY_CUSTOMER_ROW_CREATED",
      entityType: "LegacyCustomerRow",
      entityId: created.id,
      summary: { groupId: actor.groupId },
    });
    return created;
  });
  return NextResponse.json({ row: serialize(row) }, { status: 201 });
}
