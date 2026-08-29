import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { companyManagedGroupWhere, getActiveCompanyScope, requireCompanyManagerRequest, safeCompanyLeadSelect } from "../../../../lib/company-organization";
import { db } from "../../../../lib/db";
import { isActiveLeadGroupConstraintError, isUniqueConstraintError } from "../../admin/users/validation";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";
import { resolveGroupBusinessDate } from "../../../../lib/business-time";

type LeadRequest = { id?: unknown; username?: unknown; name?: unknown; password?: unknown; role?: unknown; groupId?: unknown; departmentId?: unknown; active?: unknown };

export async function GET() {
  const access = await requireCompanyManagerRequest();
  if ("response" in access) return access.response;
  const leads = await db.user.findMany({ where: { role: "LEAD", group: companyManagedGroupWhere(access.company) }, select: safeCompanyLeadSelect, orderBy: { createdAt: "desc" } });
  return NextResponse.json(leads);
}

export async function POST(request: Request) {
  const access = await requireCompanyManagerRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as LeadRequest;
  if (body.role !== undefined && body.role !== "LEAD") return NextResponse.json({ error: "公司管理员只能创建组长账号" }, { status: 400 });
  if (Object.prototype.hasOwnProperty.call(body, "departmentId")) return NextResponse.json({ error: "不能直接指定账号所属公司" }, { status: 400 });
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!username || !name || !password || !groupId) return NextResponse.json({ error: "请完整填写组长账号信息" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || groupId.length > API_LIMITS.identifierCharacters)
    return NextResponse.json({ error: "账号、姓名或小组参数过长" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH || password.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: `临时密码长度必须在 ${PASSWORD_MIN_LENGTH} 到 ${API_LIMITS.loginPasswordCharacters} 位之间` }, { status: 400 });
  const settings = await getSystemSettings();
  const now = new Date();
  try {
    const result = await db.$transaction(async (client) => {
      const company = await getActiveCompanyScope(access.actor.id, client);
      if (!company) return { error: "公司管理员必须绑定启用中的下属公司", status: 403 as const };
      const group = await client.teamGroup.findFirst({ where: { id: groupId, ...companyManagedGroupWhere(company), active: true }, select: { id: true, name: true } });
      if (!group) return { error: "只能选择本公司启用中的小组", status: 400 as const };
      if (await client.user.findFirst({ where: { role: "LEAD", active: true, groupId }, select: { id: true } })) return { error: "该小组已经有一位启用中的组长", status: 409 as const };
      const effectiveFrom = await resolveGroupBusinessDate(group.id, settings.timezone, now, client);
      const lead = await client.user.create({ data: { id: randomUUID(), employeeCode: username, username, name, passwordHash: hashPassword(password), mustChangePassword: true, role: "LEAD", groupId, departmentId: null, membershipHistory: { create: { groupId, role: "LEAD", effectiveFrom, reason: "公司管理员创建组长", createdById: access.actor.id } } }, select: safeCompanyLeadSelect });
      await recordAudit(client, { actorId: access.actor.id, action: "MEMBER_CREATED", entityType: "User", entityId: lead.id, summary: { changedFields: ["name", "username", "role", "groupId"], companyId: company.id, groupId, groupName: group.name } });
      return { lead };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return result.status === 403 ? authorizationDenied(access.actor, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.lead, { status: 201 });
  } catch (error) {
    if (isActiveLeadGroupConstraintError(error)) return NextResponse.json({ error: "该小组已经有一位启用中的组长" }, { status: 409 });
    if (isUniqueConstraintError(error)) return NextResponse.json({ error: "登录账号已存在" }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requireCompanyManagerRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as LeadRequest;
  if (typeof body.id !== "string" || body.id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "组长参数不正确" }, { status: 400 });
  if (body.role !== undefined && body.role !== "LEAD") return NextResponse.json({ error: "不能修改组长的角色" }, { status: 400 });
  if (Object.prototype.hasOwnProperty.call(body, "departmentId")) return NextResponse.json({ error: "不能直接修改账号所属公司" }, { status: 400 });
  const requested: { username?: string; name?: string; passwordHash?: string; groupId?: string; active?: boolean } = {};
  if (typeof body.username === "string") { const value = body.username.trim(); if (!value || value.length > API_LIMITS.loginUsernameCharacters) return NextResponse.json({ error: "登录账号不能为空且不能超过 200 个字" }, { status: 400 }); requested.username = value; }
  if (typeof body.name === "string") { const value = body.name.trim(); if (!value || value.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "组长姓名不能为空且不能超过 100 个字" }, { status: 400 }); requested.name = value; }
  if (typeof body.groupId === "string") { if (body.groupId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "小组参数过长" }, { status: 400 }); requested.groupId = body.groupId; }
  if (typeof body.active === "boolean") requested.active = body.active;
  if (typeof body.password === "string") { if (body.password.length < PASSWORD_MIN_LENGTH || body.password.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: `临时密码长度必须在 ${PASSWORD_MIN_LENGTH} 到 ${API_LIMITS.loginPasswordCharacters} 位之间` }, { status: 400 }); requested.passwordHash = hashPassword(body.password); }
  if (!Object.keys(requested).length) return NextResponse.json({ error: "没有可更新的组长信息" }, { status: 400 });
  try {
    const result = await db.$transaction(async (client) => {
      const company = await getActiveCompanyScope(access.actor.id, client);
      if (!company) return { error: "公司管理员必须绑定启用中的下属公司", status: 403 as const };
      const existing = await client.user.findFirst({ where: { id: body.id as string, role: "LEAD", group: companyManagedGroupWhere(company) }, select: { id: true, username: true, name: true, groupId: true, active: true } });
      if (!existing) return { error: "无权管理该组长", status: 403 as const };
      if (requested.groupId !== undefined && requested.groupId !== existing.groupId) return { error: "调组必须由系统管理员使用“办理调动”，不能直接覆盖历史小组", status: 400 as const };
      const nextGroupId = requested.groupId ?? existing.groupId;
      const nextActive = requested.active ?? existing.active;
      if (!nextGroupId) return { error: "组长必须选择小组", status: 400 as const };
      const group = await client.teamGroup.findFirst({ where: { id: nextGroupId, ...companyManagedGroupWhere(company), ...(nextActive ? { active: true } : {}) }, select: { id: true, name: true } });
      if (!group) return { error: "只能选择本公司启用中的小组", status: 400 as const };
      if (nextActive && await client.user.findFirst({ where: { role: "LEAD", active: true, groupId: nextGroupId, id: { not: existing.id } }, select: { id: true } })) return { error: "该小组已经有一位启用中的组长", status: 409 as const };
      const data: typeof requested = {};
      const changedFields: string[] = [];
      for (const field of ["username", "name", "groupId", "active"] as const) if (requested[field] !== undefined && requested[field] !== existing[field]) { data[field] = requested[field] as never; changedFields.push(field); }
      if (requested.passwordHash) { data.passwordHash = requested.passwordHash; changedFields.push("password"); }
      if (!changedFields.length) return { error: "没有可更新的组长信息", status: 400 as const };
      const lead = await client.user.update({ where: { id: existing.id }, data: { ...data, ...(data.passwordHash ? { mustChangePassword: true } : {}) }, select: safeCompanyLeadSelect });
      if (requested.passwordHash || requested.active === false) await client.session.deleteMany({ where: { userId: existing.id } });
      const action = changedFields.includes("password") ? "MEMBER_PASSWORD_RESET" : changedFields.includes("active") ? "MEMBER_STATUS_CHANGED" : "MEMBER_UPDATED";
      await recordAudit(client, { actorId: access.actor.id, action, entityType: "User", entityId: lead.id, summary: { changedFields, companyId: company.id, groupId: nextGroupId, groupName: group.name } });
      return { lead };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return result.status === 403 ? authorizationDenied(access.actor, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.lead);
  } catch (error) {
    if (isActiveLeadGroupConstraintError(error)) return NextResponse.json({ error: "该小组已经有一位启用中的组长" }, { status: 409 });
    if (isUniqueConstraintError(error)) return NextResponse.json({ error: "登录账号已存在" }, { status: 409 });
    throw error;
  }
}
