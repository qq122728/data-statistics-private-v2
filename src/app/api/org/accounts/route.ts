import { NextResponse } from "next/server";
import type { Duty, Role } from "@prisma/client";
import type { SessionUser } from "../../../../lib/auth";
import { deleteEmptyAccount } from "../../../../lib/account-deletion";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { canManageDepartment } from "../../../../lib/managed-department-scope";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { requireOrgManagerRequest } from "../_auth";

type ScopedAccount = {
  id: string;
  name: string;
  username: string;
  role: Role;
  duty: Duty | null;
  active: boolean;
  groupId: string | null;
  group: { id: string; name: string; departmentId: string; department: { companyId: string | null } } | null;
  department: { id: string; name: string; companyId: string | null } | null;
  companyId: string | null;
  resourceChannelAccess: Array<{ channelId: string }>;
};

const accountSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  duty: true,
  active: true,
  groupId: true,
  group: { select: { id: true, name: true, departmentId: true, department: { select: { companyId: true } } } },
  department: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  resourceChannelAccess: { select: { channelId: true }, orderBy: { channelId: "asc" } },
} as const;

function canManageAccount(actor: SessionUser, target: ScopedAccount): boolean {
  if (actor.id === target.id || target.role === "ADMIN" || target.duty === "HQ_MANAGER") return false;
  if (actor.role === "ADMIN" || actor.duty === "HQ_MANAGER") {
    return Boolean(target.groupId || target.role === "RESOURCE_MANAGER" || target.duty === "DEPARTMENT_MANAGER" || target.duty === "COMPANY_MANAGER");
  }
  if (actor.duty === "COMPANY_MANAGER") {
    if (!actor.companyId || target.duty === "COMPANY_MANAGER") return false;
    if (target.duty === "DEPARTMENT_MANAGER") return target.department?.companyId === actor.companyId;
    return target.group?.department.companyId === actor.companyId;
  }
  if (actor.duty === "DEPARTMENT_MANAGER") {
    if (target.duty) return false;
    return Boolean(target.group && canManageDepartment(actor, target.group.departmentId));
  }
  return false;
}

export async function GET() {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const accounts = await db.user.findMany({
    where: { id: { not: access.actor.id }, role: { notIn: ["ADMIN", "FINANCE", "HR"] } },
    select: accountSelect,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return NextResponse.json(accounts.filter((account) => canManageAccount(access.actor, account)).map((account) => ({
    id: account.id,
    name: account.name,
    username: account.username,
    role: account.role,
    duty: account.duty,
    active: account.active,
    groupName: account.group?.name ?? null,
    departmentName: account.department?.name ?? null,
    resourceChannelIds: account.resourceChannelAccess.map((item) => item.channelId),
  })));
}

export async function PATCH(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as { id?: unknown; active?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "账号参数不正确" }, { status: 400 });
  if (typeof body.active !== "boolean") return NextResponse.json({ error: "账号状态不正确" }, { status: 400 });
  const active = body.active;

  const result = await db.$transaction(async (client) => {
    const target = await client.user.findUnique({ where: { id }, select: accountSelect });
    if (!target || !canManageAccount(access.actor, target)) return { denied: true as const };
    if (target.active === active) return { account: target };
    const account = await client.user.update({ where: { id }, data: { active } });
    if (!active) await client.session.deleteMany({ where: { userId: id } });
    await recordAudit(client, {
      actorId: access.actor.id,
      action: "ORG_ACCOUNT_STATUS_CHANGED",
      entityType: "User",
      entityId: id,
      summary: { changedFields: ["active"], previousActive: target.active, active, username: target.username },
    });
    return { account };
  });
  if ("denied" in result) return authorizationDenied(access.actor, "无权修改这个账号的状态");
  return NextResponse.json({ id: result.account.id, active: result.account.active });
}

export async function DELETE(request: Request) {
  const access = await requireOrgManagerRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "账号参数不正确" }, { status: 400 });
  const target = await db.user.findUnique({ where: { id }, select: accountSelect });
  if (!target || !canManageAccount(access.actor, target)) return authorizationDenied(access.actor, "无权删除这个账号");

  const result = await deleteEmptyAccount({ actorId: access.actor.id, targetId: target.id, targetName: target.name });
  if (!result.deleted) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ deleted: true });
}
