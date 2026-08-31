import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "../../../../lib/db";
import { managedDepartmentIds } from "../../../../lib/managed-department-scope";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireOrgManagerRequest } from "../_auth";

function scopedDepartmentIds(actor: {
  role: string;
  duty: string | null;
  departmentId: string | null;
  companyId?: string | null;
  managedDepartments?: Array<{ departmentId: string }>;
}) {
  if (actor.role === "ADMIN" || actor.duty === "HQ_MANAGER") return null;
  if (actor.duty === "COMPANY_MANAGER") return actor.companyId ? { companyId: actor.companyId } : [];
  if (actor.duty === "DEPARTMENT_MANAGER") return managedDepartmentIds(actor);
  return [];
}

async function scopedGroups(actor: Parameters<typeof scopedDepartmentIds>[0]) {
  const departmentIds = scopedDepartmentIds(actor);
  if (Array.isArray(departmentIds) && departmentIds.length === 0) return [];
  return db.teamGroup.findMany({
    where: {
      active: true,
      department: { active: true, ...(!Array.isArray(departmentIds) && departmentIds ? departmentIds : {}) },
      ...(Array.isArray(departmentIds) ? { departmentId: { in: departmentIds } } : {}),
    },
    orderBy: [{ department: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      departmentId: true,
      department: { select: { id: true, name: true } },
      members: {
        where: {
          active: true,
          role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true, roleAssignments: { select: { role: true } } },
      },
    },
  });
}

export async function GET() {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const groups = await scopedGroups(access.actor);
  const groupIds = groups.map((group) => group.id);
  const [devices, accounts, channelRows] = await Promise.all([
    db.device.findMany({
      where: { groupId: { in: groupIds } },
      include: {
        group: { select: { id: true, name: true } },
        member: { select: { id: true, name: true } },
      },
      orderBy: [{ group: { name: "asc" } }, { active: "desc" }, { code: "asc" }],
    }),
    db.deviceAccount.findMany({
      where: { groupId: { in: groupIds } },
      include: {
        group: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ group: { name: "asc" } }, { renewalDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    }),
    db.channel.findMany({
      where: { groupId: { in: groupIds } },
      select: { id: true, name: true, normalizedName: true, active: true, channelType: true, fanCostMode: true, effectiveFanPriceCents: true, groupId: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);
  const channelMap = new Map<string, { id: string; name: string; active: boolean; channelType: string; fanCostMode: string; effectiveFanPriceCents: number | null; groupIds: Set<string> }>();
  for (const row of channelRows) {
    const key = row.normalizedName || row.name;
    const current = channelMap.get(key) ?? { id: row.id, name: row.name, active: true, channelType: row.channelType, fanCostMode: row.fanCostMode, effectiveFanPriceCents: row.effectiveFanPriceCents, groupIds: new Set<string>() };
    current.active = current.active && row.active;
    current.groupIds.add(row.groupId);
    channelMap.set(key, current);
  }
  const channels = [...channelMap.values()].map((channel) => ({ ...channel, groupCount: channel.groupIds.size, groupIds: [...channel.groupIds] }));
  return NextResponse.json(
    { groups, devices, accounts, channels, accountMaintenance: "OWNER_OR_LEAD", deviceMaintenance: access.actor.duty === "COMPANY_MANAGER" ? "READ_ONLY" : "DEPARTMENT_MANAGER" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const createDeviceSchema = z.object({
  groupId: z.string().min(1).max(100),
  code: z.string().trim().min(1, "请输入设备编号").max(50),
}).strict();

const assignDeviceSchema = z.object({
  id: z.string().min(1).max(100),
  memberId: z.string().min(1).max(100).nullable(),
}).strict();

function canMaintainDepartmentAssets(actor: { role: string; duty: string | null }) {
  return actor.role === "ADMIN" || actor.duty === "HQ_MANAGER" || actor.duty === "DEPARTMENT_MANAGER";
}

export async function POST(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  if (!canMaintainDepartmentAssets(access.actor)) return authorizationDenied(access.actor, "没有权限维护部门设备");
  const parsed = createDeviceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "设备参数不正确" }, { status: 400 });
  const groups = await scopedGroups(access.actor);
  if (!groups.some((group) => group.id === parsed.data.groupId)) return authorizationDenied(access.actor, "只能维护管理范围内小组的设备");
  const exists = await db.device.findUnique({ where: { groupId_code: { groupId: parsed.data.groupId, code: parsed.data.code } }, select: { id: true } });
  if (exists) return NextResponse.json({ error: "该小组已经存在这个设备编号" }, { status: 409 });
  const device = await db.$transaction(async (transaction) => {
    const created = await transaction.device.create({
      data: { groupId: parsed.data.groupId, code: parsed.data.code },
      include: { group: { select: { id: true, name: true } }, member: { select: { id: true, name: true } } },
    });
    await transaction.auditLog.create({ data: { actorId: access.actor.id, action: "DEPARTMENT_DEVICE_CREATED", entityType: "Device", entityId: created.id, summary: `${created.group.name} · ${created.code}` } });
    return created;
  });
  return NextResponse.json({ device }, { status: 201 });
}

export async function PATCH(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  if (!canMaintainDepartmentAssets(access.actor)) return authorizationDenied(access.actor, "没有权限维护部门设备");
  const parsed = assignDeviceSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "设备分配参数不正确" }, { status: 400 });
  const groups = await scopedGroups(access.actor);
  const groupIds = groups.map((group) => group.id);
  const existing = await db.device.findFirst({ where: { id: parsed.data.id, groupId: { in: groupIds } }, select: { id: true, code: true, groupId: true } });
  if (!existing) return NextResponse.json({ error: "设备不存在或不在当前部门" }, { status: 404 });
  if (parsed.data.memberId) {
    const member = await db.user.findFirst({
      where: { id: parsed.data.memberId, groupId: existing.groupId, active: true, role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
      select: { id: true },
    });
    if (!member) return NextResponse.json({ error: "设备只能分配给同组在职成员" }, { status: 400 });
  }
  const device = await db.$transaction(async (transaction) => {
    const updated = await transaction.device.update({
      where: { id: existing.id },
      data: { memberId: parsed.data.memberId },
      include: { group: { select: { id: true, name: true } }, member: { select: { id: true, name: true } } },
    });
    await transaction.auditLog.create({ data: { actorId: access.actor.id, action: parsed.data.memberId ? "DEPARTMENT_DEVICE_ASSIGNED" : "DEPARTMENT_DEVICE_UNASSIGNED", entityType: "Device", entityId: updated.id, summary: `${updated.group.name} · ${updated.code}` } });
    return updated;
  });
  return NextResponse.json({ device });
}
