import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { hasAssignedRole } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";

async function requireLead() {
  try {
    const actor = await requireUser();
    if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "LEAD")) return { response: authorizationDenied(actor, "只有在职组长可以管理本组实体设备") };
    return { actor };
  } catch (error) {
    if (error instanceof AuthenticationError) return { response: NextResponse.json({ error: "请先登录" }, { status: 401 }) };
    throw error;
  }
}

export async function GET() {
  const access = await requireLead();
  if ("response" in access) return access.response;
  const groupId = access.actor.groupId!;
  const devices = await db.device.findMany({
    where: { groupId },
    include: { member: { select: { id: true, name: true } } },
    orderBy: [{ active: "desc" }, { code: "asc" }],
  });
  return NextResponse.json({ devices }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await requireLead();
  if ("response" in access) return access.response;
  const parsed = z.object({ code: z.string().trim().min(1, "请输入设备编号").max(50) }).strict().safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "设备编号不正确" }, { status: 400 });
  const exists = await db.device.findUnique({ where: { groupId_code: { groupId: access.actor.groupId!, code: parsed.data.code } }, select: { id: true } });
  if (exists) return NextResponse.json({ error: "本组已经存在这个设备编号" }, { status: 409 });
  const device = await db.$transaction(async (transaction) => {
    const created = await transaction.device.create({ data: { groupId: access.actor.groupId!, code: parsed.data.code }, include: { member: { select: { id: true, name: true } } } });
    await transaction.auditLog.create({ data: { actorId: access.actor.id, action: "GROUP_DEVICE_CREATED", entityType: "Device", entityId: created.id, summary: created.code } });
    return created;
  });
  return NextResponse.json({ device }, { status: 201 });
}

export async function PATCH(request: Request) {
  const access = await requireLead();
  if ("response" in access) return access.response;
  const groupId = access.actor.groupId!;
  const parsed = z.object({ id: z.string().min(1).max(100), memberId: z.string().min(1).max(100).nullable() }).strict().safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "设备分配参数不正确" }, { status: 400 });
  const existing = await db.device.findFirst({ where: { id: parsed.data.id, groupId }, select: { id: true, code: true } });
  if (!existing) return NextResponse.json({ error: "设备不存在或不属于本组" }, { status: 404 });
  if (parsed.data.memberId) {
    const member = await db.user.findFirst({
      where: { id: parsed.data.memberId, groupId, active: true, OR: [{ role: "RECEPTION" }, { roleAssignments: { some: { role: "RECEPTION" } } }] },
      select: { id: true },
    });
    if (!member) return NextResponse.json({ error: "实体设备只能分配给本组在职接粉" }, { status: 400 });
  }
  const device = await db.$transaction(async (transaction) => {
    const updated = await transaction.device.update({ where: { id: existing.id }, data: { memberId: parsed.data.memberId }, include: { member: { select: { id: true, name: true } } } });
    await transaction.auditLog.create({ data: { actorId: access.actor.id, action: parsed.data.memberId ? "GROUP_DEVICE_ASSIGNED" : "GROUP_DEVICE_UNASSIGNED", entityType: "Device", entityId: updated.id, summary: updated.code } });
    return updated;
  });
  return NextResponse.json({ device });
}
