import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { requireAdminRequest } from "../_auth";
import { authorizeHighRiskOperation, HighRiskAuthorizationError } from "../_high-risk";
import { authorizationDenied } from "../../../../lib/security-events";
import { getMemberProtectionError, isActiveLeadGroupConstraintError, isUniqueConstraintError, parseEmploymentUpdate, parseRecruitmentUpdate, type EmploymentStage, type RecruitmentSource } from "./validation";
import { parseFrontlineSecondaryRoles } from "../../../../lib/role-assignments";
import { API_LIMITS } from "../../../../lib/request-limits";
import { getSystemSettings } from "../../../../lib/settings";
import { resolveGroupBusinessDate } from "../../../../lib/business-time";

type UserRequest = { id?: unknown; employeeCode?: unknown; username?: unknown; name?: unknown; password?: unknown; role?: unknown; secondaryRoles?: unknown; resourceChannelIds?: unknown; groupId?: unknown; departmentId?: unknown; managementScopeName?: unknown; managementCountryCode?: unknown; active?: unknown; hireDate?: unknown; recruitmentSource?: unknown; referrerName?: unknown; stageOverride?: unknown; stageOverrideReason?: unknown; highRiskReason?: unknown; currentPassword?: unknown };
const roles = ["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER", "FINANCE", "HR", "LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;
type UserRole = (typeof roles)[number];
type UserMutationClient = Prisma.TransactionClient | Pick<PrismaClient, "teamGroup" | "department">;
const safeUserSelect = {
  id: true, employeeCode: true, username: true, name: true, role: true, groupId: true, departmentId: true, managementScopeName: true, managementCountryCode: true, active: true,
  hireDate: true, recruitmentSource: true, referrerName: true, stageOverride: true, stageOverrideReason: true, stageOverrideAt: true,
  lastLoginAt: true, createdAt: true, updatedAt: true,
  group: { select: { id: true, name: true, active: true, department: { select: { name: true } } } },
  department: { select: { id: true, name: true, active: true } },
  roleAssignments: { select: { role: true }, orderBy: { role: "asc" } },
  resourceChannelAccess: { select: { channelId: true }, orderBy: { channelId: "asc" } },
  membershipHistory: { select: { id: true, groupId: true, role: true, secondaryRoles: true, effectiveFrom: true, effectiveTo: true, reason: true, group: { select: { name: true } } }, orderBy: { effectiveFrom: "desc" } },
} as const;

function parseEmployeeCode(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code) ? code : null;
}

function parseResourceChannelIds(role: UserRole, value: unknown): { success: true; value: string[] } | { success: false; error: string } {
  if (role !== "RESOURCE_MANAGER") return Array.isArray(value) && value.length ? { success: false, error: "只有资源部管理员可以绑定渠道" } : { success: true, value: [] };
  if (!Array.isArray(value)) return { success: false, error: "资源部管理员必须选择至少一个可见渠道" };
  if (value.length > API_LIMITS.batchRows || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > API_LIMITS.identifierCharacters)) return { success: false, error: "资源渠道参数不正确" };
  const ids = [...new Set(value as string[])];
  if (!ids.length) return { success: false, error: "资源部管理员必须选择至少一个可见渠道" };
  return { success: true, value: ids };
}

async function hasValidOrganizationScope(role: UserRole, groupId: string | null, departmentId: string | null, managementCountryCode: string | null, client: UserMutationClient) {
  if (role === "ADMIN" || role === "RESOURCE_MANAGER" || role === "FINANCE" || role === "HR") return !groupId && !departmentId;
  if (role === "COMPANY_MANAGER") {
    if (groupId || !departmentId) return false;
    if (!await client.department.findFirst({ where: { id: departmentId, active: true }, select: { id: true } })) return false;
    if (!managementCountryCode) return true;
    return Boolean(await client.teamGroup.findFirst({ where: { departmentId, active: true, OR: [{ countryCode: managementCountryCode }, { countryCode: null, department: { countryCode: managementCountryCode } }] }, select: { id: true } }));
  }
  if (!groupId || departmentId) return false;
  return Boolean(await client.teamGroup.findFirst({
    where: { id: groupId, active: true, department: { active: true } },
    select: { id: true },
  }));
}

function organizationScopeError(role: UserRole) {
  if (role === "COMPANY_MANAGER") return "公司管理员必须选择启用中的下属公司";
  if (role === "ADMIN" || role === "RESOURCE_MANAGER" || role === "FINANCE" || role === "HR") return "系统管理员、资源部管理员、财务和行政不能绑定公司或小组";
  return "一线岗位和组长必须选择启用中的小组";
}

export async function POST(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;
  const body = (await request.json()) as UserRequest;
  if (typeof body.currentPassword === "string" && body.currentPassword.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: "当前管理员密码长度超过限制" }, { status: 400 });
  if (typeof body.highRiskReason === "string" && body.highRiskReason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "操作原因不能超过 500 个字" }, { status: 400 });
  const username = typeof body.username === "string" ? body.username.trim() : "";
  // 旧版内部调用尚未传人员代号时生成一次性永久代号；新版后台会要求管理员明确填写。
  const employeeCode = body.employeeCode === undefined ? `AUTO-${randomUUID().slice(0, 8).toUpperCase()}` : parseEmployeeCode(body.employeeCode);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = typeof body.role === "string" && roles.includes(body.role as UserRole) ? body.role as UserRole : null;
  const groupId = typeof body.groupId === "string" && body.groupId ? body.groupId : null;
  const departmentId = typeof body.departmentId === "string" && body.departmentId ? body.departmentId : null;
  const managementScopeName = typeof body.managementScopeName === "string" && body.managementScopeName.trim() ? body.managementScopeName.trim() : null;
  const managementCountryCode = typeof body.managementCountryCode === "string" && body.managementCountryCode.trim() ? body.managementCountryCode.trim().toUpperCase() : null;
  if (!employeeCode) return NextResponse.json({ error: "人员代号必须为 2 到 32 位英文字母、数字、横线或下划线" }, { status: 400 });
  if (!username || !name || !password || !role) return NextResponse.json({ error: "请完整填写成员信息" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || password.length > API_LIMITS.loginPasswordCharacters)
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  if ((groupId?.length ?? 0) > API_LIMITS.identifierCharacters || (departmentId?.length ?? 0) > API_LIMITS.identifierCharacters)
    return NextResponse.json({ error: "组织参数过长" }, { status: 400 });
  if ((managementScopeName?.length ?? 0) > 60 || (managementCountryCode && !/^[A-Z]{2}$/.test(managementCountryCode))) return NextResponse.json({ error: "部门名称或市场国家不正确" }, { status: 400 });
  if (role !== "COMPANY_MANAGER" && (managementScopeName || managementCountryCode)) return NextResponse.json({ error: "只有公司管理员角色可以设置部门管理范围" }, { status: 400 });
  if (role === "COMPANY_MANAGER" && Boolean(managementScopeName) !== Boolean(managementCountryCode)) return NextResponse.json({ error: "部门管理员必须同时填写部门名称和市场国家" }, { status: 400 });
  const secondaryRoles = parseFrontlineSecondaryRoles(role, body.secondaryRoles);
  if (!secondaryRoles.success) return NextResponse.json({ error: secondaryRoles.error }, { status: 400 });
  const resourceChannels = parseResourceChannelIds(role, body.resourceChannelIds);
  if (!resourceChannels.success) return NextResponse.json({ error: resourceChannels.error }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) return NextResponse.json({ error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });
  const employment = parseEmploymentUpdate(body as Record<string, unknown>);
  if (!employment.success) return NextResponse.json({ error: employment.error }, { status: 400 });
  const recruitment = parseRecruitmentUpdate(body as Record<string, unknown>);
  if (!recruitment.success) return NextResponse.json({ error: recruitment.error }, { status: 400 });
  const settings = await getSystemSettings();
  const now = new Date();

  try {
    const result = await db.$transaction(async (client) => {
      if (!(await hasValidOrganizationScope(role, groupId, departmentId, managementCountryCode, client))) {
        return { error: organizationScopeError(role), status: 400 as const };
      }
      if (role === "LEAD" && groupId && await client.user.findFirst({
        where: { role: "LEAD", active: true, groupId },
        select: { id: true },
      })) {
        return { error: "该小组已经有一位启用中的组长", status: 409 as const };
      }
      if (resourceChannels.value.length) {
        const channels = await client.channel.findMany({ where: { id: { in: resourceChannels.value } }, select: { id: true, channelType: true } });
        if (new Set(channels.map((channel) => channel.id)).size !== resourceChannels.value.length) return { error: "选择的资源渠道不存在", status: 400 as const };
        if (new Set(channels.map((channel) => channel.channelType)).size !== 1) return { error: "一个资源部账号只能选择一种渠道类型（投流或短信）", status: 400 as const };
      }
      const highRisk = role === "ADMIN"
        ? await authorizeHighRiskOperation(client, access.actor.id, body)
        : null;
      const membershipEffectiveFrom = groupId
        ? employment.value.hireDate ?? await resolveGroupBusinessDate(groupId, settings.timezone, now, client)
        : null;
      const created = await client.user.create({
        data: {
          id: randomUUID(), employeeCode, username, name, passwordHash: hashPassword(password), mustChangePassword: true, role, groupId, departmentId, managementScopeName, managementCountryCode,
          roleAssignments: { create: [role, ...secondaryRoles.value].map((assignedRole) => ({ role: assignedRole })) },
          ...(resourceChannels.value.length ? { resourceChannelAccess: { create: resourceChannels.value.map((channelId) => ({ channelId })) } } : {}),
          ...(groupId ? { membershipHistory: { create: { groupId, role, secondaryRoles: secondaryRoles.value.join(",") || null, effectiveFrom: membershipEffectiveFrom!, reason: "创建人员档案", createdById: access.actor.id } } } : {}),
          ...employment.value,
          ...recruitment.value,
          ...(employment.value.stageOverride ? { stageOverrideAt: new Date() } : {}),
        },
        select: safeUserSelect,
      });
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "MEMBER_CREATED",
        entityType: "User",
        entityId: created.id,
        summary: {
          changedFields: ["employeeCode", "name", "username", "role", "secondaryRoles", ...(role === "RESOURCE_MANAGER" ? ["resourceChannelIds"] : []), ...(role === "COMPANY_MANAGER" ? ["departmentId", ...(managementCountryCode ? ["managementScopeName", "managementCountryCode"] : [])] : ["groupId"])],
          ...(highRisk ? {
            name: created.name,
            highRiskReason: highRisk.highRiskReason,
            reauthenticated: highRisk.reauthenticated,
            before: { exists: false, role: null },
            after: {
              exists: true,
              username: created.username,
              name: created.name,
              role: created.role,
              groupId: created.groupId,
              departmentId: created.departmentId,
              active: created.active,
            },
            impact: {
              targetUserId: created.id,
              grantsFullAdministrativeAccess: true,
              activeSessions: 0,
              invalidatedSessions: 0,
            },
          } : {}),
        },
      });
      const employmentChangedFields = (["hireDate", "stageOverride", "stageOverrideReason"] as const)
        .filter((field) => employment.value[field] !== undefined && employment.value[field] !== null);
      if (employmentChangedFields.length) {
        await recordAudit(client, {
          actorId: access.actor.id,
          action: "USER_EMPLOYMENT_UPDATED",
          entityType: "User",
          entityId: created.id,
          summary: {
            changedFields: employmentChangedFields,
            name: created.name,
            before: { hireDate: null, stageOverride: null, stageOverrideReason: null },
            after: { hireDate: created.hireDate, stageOverride: created.stageOverride, stageOverrideReason: created.stageOverrideReason },
          },
        });
      }
      const recruitmentChangedFields = (["recruitmentSource", "referrerName"] as const)
        .filter((field) => recruitment.value[field] !== undefined && recruitment.value[field] !== null);
      if (recruitmentChangedFields.length) {
        await recordAudit(client, {
          actorId: access.actor.id,
          action: "USER_RECRUITMENT_UPDATED",
          entityType: "User",
          entityId: created.id,
          summary: {
            changedFields: recruitmentChangedFields,
            name: created.name,
            before: { recruitmentSource: null, referrerName: null },
            after: { recruitmentSource: created.recruitmentSource, referrerName: created.referrerName },
          },
        });
      }
      return { user: created };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.user, { status: 201 });
  } catch (error) {
    if (error instanceof HighRiskAuthorizationError) return error.status === 403 ? authorizationDenied(access.actor, error.message) : NextResponse.json({ error: error.message }, { status: error.status });
    if (isActiveLeadGroupConstraintError(error)) return NextResponse.json({ error: "该小组已经有一位启用中的组长" }, { status: 409 });
    if (isUniqueConstraintError(error)) return NextResponse.json({ error: "登录账号或人员代号已存在" }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requireAdminRequest();
  if ("response" in access) return access.response;
  const body = (await request.json()) as UserRequest;
  if (typeof body.currentPassword === "string" && body.currentPassword.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: "当前管理员密码长度超过限制" }, { status: 400 });
  if (typeof body.highRiskReason === "string" && body.highRiskReason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "操作原因不能超过 500 个字" }, { status: 400 });
  if (typeof body.id !== "string" || body.id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "成员参数不正确" }, { status: 400 });

  const requested: { username?: string; name?: string; passwordHash?: string; role?: UserRole; groupId?: string | null; departmentId?: string | null; managementScopeName?: string | null; managementCountryCode?: string | null; active?: boolean; hireDate?: string | null; recruitmentSource?: RecruitmentSource | null; referrerName?: string | null; stageOverride?: EmploymentStage | null; stageOverrideReason?: string | null; stageOverrideAt?: Date | null } = {};
  if (typeof body.username === "string") { const value = body.username.trim(); if (!value || value.length > API_LIMITS.loginUsernameCharacters) return NextResponse.json({ error: "登录账号不能为空且不能超过 200 个字" }, { status: 400 }); requested.username = value; }
  if (typeof body.name === "string") { const value = body.name.trim(); if (!value || value.length > API_LIMITS.accountDisplayNameCharacters) return NextResponse.json({ error: "成员姓名不能为空且不能超过 100 个字" }, { status: 400 }); requested.name = value; }
  if (typeof body.role === "string" && roles.includes(body.role as UserRole)) requested.role = body.role as UserRole;
  if (typeof body.groupId === "string" || body.groupId === null) {
    if ((body.groupId?.length ?? 0) > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "小组参数过长" }, { status: 400 });
    requested.groupId = body.groupId || null;
  }
  if (typeof body.departmentId === "string" || body.departmentId === null) {
    if ((body.departmentId?.length ?? 0) > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "公司参数过长" }, { status: 400 });
    requested.departmentId = body.departmentId || null;
  }
  if (typeof body.managementScopeName === "string" || body.managementScopeName === null) {
    const value = typeof body.managementScopeName === "string" ? body.managementScopeName.trim() : "";
    if (value.length > 60) return NextResponse.json({ error: "部门名称不能超过 60 个字" }, { status: 400 });
    requested.managementScopeName = value || null;
  }
  if (typeof body.managementCountryCode === "string" || body.managementCountryCode === null) {
    const value = typeof body.managementCountryCode === "string" ? body.managementCountryCode.trim().toUpperCase() : "";
    if (value && !/^[A-Z]{2}$/.test(value)) return NextResponse.json({ error: "市场国家参数不正确" }, { status: 400 });
    requested.managementCountryCode = value || null;
  }
  if (typeof body.active === "boolean") requested.active = body.active;
  if (typeof body.password === "string") {
    if (body.password.length < PASSWORD_MIN_LENGTH || body.password.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: `临时密码长度必须在 ${PASSWORD_MIN_LENGTH} 到 ${API_LIMITS.loginPasswordCharacters} 位之间` }, { status: 400 });
    requested.passwordHash = hashPassword(body.password);
  }
  const employment = parseEmploymentUpdate(body as Record<string, unknown>);
  if (!employment.success) return NextResponse.json({ error: employment.error }, { status: 400 });
  Object.assign(requested, employment.value);
  const recruitment = parseRecruitmentUpdate(body as Record<string, unknown>);
  if (!recruitment.success) return NextResponse.json({ error: recruitment.error }, { status: 400 });
  Object.assign(requested, recruitment.value);
  const includesSecondaryRoles = Object.prototype.hasOwnProperty.call(body, "secondaryRoles");
  const includesResourceChannels = Object.prototype.hasOwnProperty.call(body, "resourceChannelIds");
  if (!Object.keys(requested).length && !includesSecondaryRoles && !includesResourceChannels) return NextResponse.json({ error: "没有可更新的成员信息" }, { status: 400 });

  try {
    const result = await db.$transaction(async (client) => {
      const existing = await client.user.findUnique({ where: { id: body.id as string }, select: { id: true, username: true, name: true, role: true, groupId: true, departmentId: true, managementScopeName: true, managementCountryCode: true, active: true, hireDate: true, recruitmentSource: true, referrerName: true, stageOverride: true, stageOverrideReason: true, roleAssignments: { select: { role: true } }, resourceChannelAccess: { select: { channelId: true } } } });
      if (!existing) return { error: "成员不存在", status: 404 as const };

      const personnelRoles: UserRole[] = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"];
      const nextRequestedRole = requested.role ?? existing.role;
      const staysInPersonnelScope = personnelRoles.includes(existing.role) && personnelRoles.includes(nextRequestedRole);
      if (staysInPersonnelScope && requested.role !== undefined && requested.role !== existing.role)
        return { error: "岗位调整必须使用“办理调动”，不能直接覆盖历史岗位", status: 400 as const };
      if (staysInPersonnelScope && Object.prototype.hasOwnProperty.call(requested, "groupId") && requested.groupId !== existing.groupId)
        return { error: "小组调整必须使用“办理调动”，不能直接覆盖历史小组", status: 400 as const };

      const data: typeof requested = {};
      const changedFields: string[] = [];
      if (requested.username !== undefined && requested.username !== existing.username) { data.username = requested.username; changedFields.push("username"); }
      if (requested.name !== undefined && requested.name !== existing.name) { data.name = requested.name; changedFields.push("name"); }
      if (requested.role !== undefined && requested.role !== existing.role) { data.role = requested.role; changedFields.push("role"); }
      if (Object.prototype.hasOwnProperty.call(requested, "groupId") && requested.groupId !== existing.groupId) { data.groupId = requested.groupId; changedFields.push("groupId"); }
      if (Object.prototype.hasOwnProperty.call(requested, "departmentId") && requested.departmentId !== existing.departmentId) { data.departmentId = requested.departmentId; changedFields.push("departmentId"); }
      if (Object.prototype.hasOwnProperty.call(requested, "managementScopeName") && requested.managementScopeName !== existing.managementScopeName) { data.managementScopeName = requested.managementScopeName; changedFields.push("managementScopeName"); }
      if (Object.prototype.hasOwnProperty.call(requested, "managementCountryCode") && requested.managementCountryCode !== existing.managementCountryCode) { data.managementCountryCode = requested.managementCountryCode; changedFields.push("managementCountryCode"); }
      if (requested.active !== undefined && requested.active !== existing.active) { data.active = requested.active; changedFields.push("active"); }
      if (requested.passwordHash) { data.passwordHash = requested.passwordHash; changedFields.push("password"); }
      if (Object.prototype.hasOwnProperty.call(requested, "hireDate") && requested.hireDate !== existing.hireDate) { data.hireDate = requested.hireDate; changedFields.push("hireDate"); }
      if (Object.prototype.hasOwnProperty.call(requested, "recruitmentSource") && requested.recruitmentSource !== existing.recruitmentSource) { data.recruitmentSource = requested.recruitmentSource; changedFields.push("recruitmentSource"); }
      if (Object.prototype.hasOwnProperty.call(requested, "referrerName") && requested.referrerName !== existing.referrerName) { data.referrerName = requested.referrerName; changedFields.push("referrerName"); }
      if (Object.prototype.hasOwnProperty.call(requested, "stageOverride") && requested.stageOverride !== existing.stageOverride) { data.stageOverride = requested.stageOverride; changedFields.push("stageOverride"); }
      if (Object.prototype.hasOwnProperty.call(requested, "stageOverrideReason") && requested.stageOverrideReason !== existing.stageOverrideReason) { data.stageOverrideReason = requested.stageOverrideReason; changedFields.push("stageOverrideReason"); }

      const nextStageOverride = Object.prototype.hasOwnProperty.call(requested, "stageOverride") ? requested.stageOverride ?? null : existing.stageOverride;
      const nextStageOverrideReason = nextStageOverride === null ? null
        : Object.prototype.hasOwnProperty.call(requested, "stageOverrideReason") ? requested.stageOverrideReason ?? null : existing.stageOverrideReason;
      if (nextStageOverride !== null && (!nextStageOverrideReason || nextStageOverrideReason.length < 4)) {
        return { error: "手动阶段原因至少需要 4 个字", status: 400 as const };
      }
      const changesEmployment = changedFields.some((field) => field === "hireDate" || field === "stageOverride" || field === "stageOverrideReason");
      const changesOverride = changedFields.some((field) => field === "stageOverride" || field === "stageOverrideReason");
      if (changesOverride && nextStageOverride === null) {
        if (existing.stageOverrideReason !== null && !changedFields.includes("stageOverrideReason")) changedFields.push("stageOverrideReason");
        data.stageOverrideReason = null;
        data.stageOverrideAt = null;
      } else if (changesOverride && nextStageOverride !== null) {
        data.stageOverrideReason = nextStageOverrideReason;
        data.stageOverrideAt = new Date();
      }
      const nextRole = data.role ?? existing.role;
      if (nextRole !== "COMPANY_MANAGER" && (requested.managementScopeName || requested.managementCountryCode)) {
        return { error: "只有公司管理员角色可以设置部门管理范围", status: 400 as const };
      }
      if (nextRole !== "COMPANY_MANAGER") {
        if (existing.managementScopeName !== null) { data.managementScopeName = null; if (!changedFields.includes("managementScopeName")) changedFields.push("managementScopeName"); }
        if (existing.managementCountryCode !== null) { data.managementCountryCode = null; if (!changedFields.includes("managementCountryCode")) changedFields.push("managementCountryCode"); }
      }
      const currentResourceChannelIds = existing.resourceChannelAccess.map((access) => access.channelId).sort();
      const requestedResourceChannelIds = includesResourceChannels ? body.resourceChannelIds : nextRole === existing.role ? currentResourceChannelIds : [];
      const nextResourceChannels = parseResourceChannelIds(nextRole, requestedResourceChannelIds);
      if (!nextResourceChannels.success) return { error: nextResourceChannels.error, status: 400 as const };
      const sortedNextResourceChannelIds = [...nextResourceChannels.value].sort();
      const resourceChannelsChanged = currentResourceChannelIds.join(",") !== sortedNextResourceChannelIds.join(",");
      if (resourceChannelsChanged) {
        const channels = await client.channel.findMany({ where: { id: { in: sortedNextResourceChannelIds } }, select: { id: true, channelType: true } });
        if (new Set(channels.map((channel) => channel.id)).size !== sortedNextResourceChannelIds.length) return { error: "选择的资源渠道不存在", status: 400 as const };
        if (new Set(channels.map((channel) => channel.channelType)).size !== 1) return { error: "一个资源部账号只能选择一种渠道类型（投流或短信）", status: 400 as const };
        changedFields.push("resourceChannelIds");
      }
      const currentSecondaryRoles = existing.roleAssignments.map((assignment) => assignment.role).filter((assignedRole) => assignedRole !== existing.role);
      const requestedSecondaryRoles = includesSecondaryRoles
        ? body.secondaryRoles
        : nextRole === existing.role ? currentSecondaryRoles : [];
      const nextSecondaryRoles = parseFrontlineSecondaryRoles(nextRole, requestedSecondaryRoles);
      if (!nextSecondaryRoles.success) return { error: nextSecondaryRoles.error, status: 400 as const };
      const roleAssignmentsChanged = nextRole !== existing.role
        || currentSecondaryRoles.length !== nextSecondaryRoles.value.length
        || currentSecondaryRoles.some((assignedRole) => !nextSecondaryRoles.value.includes(assignedRole));
      if (staysInPersonnelScope && roleAssignmentsChanged)
        return { error: "兼任岗位调整必须使用“办理调动”，不能直接覆盖历史岗位", status: 400 as const };
      if (roleAssignmentsChanged) changedFields.push("secondaryRoles");
      if (!changedFields.length) return { error: "没有可更新的成员信息", status: 400 as const };

      const nextGroupId = Object.prototype.hasOwnProperty.call(data, "groupId") ? data.groupId ?? null : existing.groupId;
      const nextDepartmentId = Object.prototype.hasOwnProperty.call(data, "departmentId") ? data.departmentId ?? null : existing.departmentId;
      const nextManagementScopeName = Object.prototype.hasOwnProperty.call(data, "managementScopeName") ? data.managementScopeName ?? null : existing.managementScopeName;
      const nextManagementCountryCode = Object.prototype.hasOwnProperty.call(data, "managementCountryCode") ? data.managementCountryCode ?? null : existing.managementCountryCode;
      const nextActive = data.active ?? existing.active;
      if (nextRole === "COMPANY_MANAGER" && Boolean(nextManagementScopeName) !== Boolean(nextManagementCountryCode)) return { error: "部门管理员必须同时填写部门名称和市场国家", status: 400 as const };
      const changesMembershipBoundary = changedFields.some((field) => field === "role" || field === "groupId" || field === "departmentId" || field === "managementScopeName" || field === "managementCountryCode" || field === "active");
      if (changesMembershipBoundary && nextActive && !(await hasValidOrganizationScope(nextRole, nextGroupId, nextDepartmentId, nextManagementCountryCode, client))) {
        return { error: organizationScopeError(nextRole), status: 400 as const };
      }
      if (nextActive && nextRole === "LEAD" && nextGroupId && await client.user.findFirst({
        where: { role: "LEAD", active: true, groupId: nextGroupId, id: { not: existing.id } },
        select: { id: true },
      })) {
        return { error: "该小组已经有一位启用中的组长", status: 409 as const };
      }
      const activeAdminCount = await client.user.count({ where: { role: "ADMIN", active: true } });
      const protection = getMemberProtectionError({ actorId: access.actor.id, targetId: existing.id, currentRole: existing.role, currentActive: existing.active, nextRole, nextActive, activeAdminCount });
      if (protection) return { error: protection, status: 400 as const };

      const promotesToAdmin = existing.role !== "ADMIN" && nextRole === "ADMIN";
      const reactivatesAdmin = existing.role === "ADMIN" && !existing.active && nextRole === "ADMIN" && nextActive;
      const revokesAdminAccess = existing.role === "ADMIN" && (nextRole !== "ADMIN" || (existing.active && !nextActive));
      const resetsExistingAdminPassword = existing.role === "ADMIN" && changedFields.includes("password");
      const highRisk = promotesToAdmin || reactivatesAdmin || revokesAdminAccess || resetsExistingAdminPassword
        ? await authorizeHighRiskOperation(client, access.actor.id, body)
        : null;
      const activeSessions = highRisk
        ? await client.session.count({ where: { userId: existing.id, expiresAt: { gt: new Date() } } })
        : 0;

      const updated = await client.user.update({ where: { id: existing.id }, data: {
        ...data,
        ...(data.passwordHash ? { mustChangePassword: true } : {}),
        ...(roleAssignmentsChanged ? { roleAssignments: { deleteMany: {}, create: [nextRole, ...nextSecondaryRoles.value].map((assignedRole) => ({ role: assignedRole })) } } : {}),
        ...(resourceChannelsChanged ? { resourceChannelAccess: { deleteMany: {}, create: sortedNextResourceChannelIds.map((channelId) => ({ channelId })) } } : {}),
      }, select: safeUserSelect });
      let invalidatedSessions = 0;
      if (data.passwordHash || highRisk || changesMembershipBoundary) {
        const deletion = await client.session.deleteMany({ where: { userId: existing.id } });
        invalidatedSessions = deletion.count;
      }
      const action = promotesToAdmin ? "MEMBER_ADMIN_GRANTED"
        : reactivatesAdmin ? "MEMBER_ADMIN_REACTIVATED"
        : revokesAdminAccess ? "MEMBER_ADMIN_ACCESS_REVOKED"
        : resetsExistingAdminPassword ? "MEMBER_ADMIN_PASSWORD_RESET"
        : changedFields.some((field) => field === "managementScopeName" || field === "managementCountryCode" || field === "departmentId") && nextRole === "COMPANY_MANAGER" ? "DEPARTMENT_MANAGER_SCOPE_UPDATED"
        : changesEmployment ? "USER_EMPLOYMENT_UPDATED"
        : changedFields.length === 1 && changedFields[0] === "active" ? "MEMBER_STATUS_CHANGED"
        : changedFields.includes("password") ? "MEMBER_PASSWORD_RESET" : "MEMBER_UPDATED";
      const changesDepartmentManagerScope = action === "DEPARTMENT_MANAGER_SCOPE_UPDATED";
      await recordAudit(client, {
        actorId: access.actor.id,
        action,
        entityType: "User",
        entityId: existing.id,
        summary: {
          changedFields,
          ...(changesDepartmentManagerScope ? {
            name: updated.name,
            before: { departmentId: existing.departmentId, managementScopeName: existing.managementScopeName, managementCountryCode: existing.managementCountryCode },
            after: { departmentId: updated.departmentId, managementScopeName: updated.managementScopeName, managementCountryCode: updated.managementCountryCode },
            invalidatedSessions,
          } : {}),
          ...(changesEmployment && !highRisk ? {
            name: updated.name,
            before: { hireDate: existing.hireDate, stageOverride: existing.stageOverride, stageOverrideReason: existing.stageOverrideReason },
            after: { hireDate: updated.hireDate, stageOverride: updated.stageOverride, stageOverrideReason: updated.stageOverrideReason },
          } : {}),
          ...(changedFields.some((field) => field === "recruitmentSource" || field === "referrerName") && !highRisk ? {
            recruitment: {
              before: { recruitmentSource: existing.recruitmentSource, referrerName: existing.referrerName },
              after: { recruitmentSource: updated.recruitmentSource, referrerName: updated.referrerName },
            },
          } : {}),
          ...(highRisk ? {
            name: updated.name,
            highRiskReason: highRisk.highRiskReason,
            reauthenticated: highRisk.reauthenticated,
            before: {
              username: existing.username,
              name: existing.name,
              role: existing.role,
              groupId: existing.groupId,
              departmentId: existing.departmentId,
              active: existing.active,
              hireDate: existing.hireDate,
              stageOverride: existing.stageOverride,
              stageOverrideReason: existing.stageOverrideReason,
            },
            after: {
              username: updated.username,
              name: updated.name,
              role: updated.role,
              groupId: updated.groupId,
              departmentId: updated.departmentId,
              active: updated.active,
              hireDate: updated.hireDate,
              stageOverride: updated.stageOverride,
              stageOverrideReason: updated.stageOverrideReason,
            },
            impact: {
              targetUserId: updated.id,
              previousRole: existing.role,
              grantsAdminRole: promotesToAdmin,
              grantsFullAdministrativeAccess: nextRole === "ADMIN" && nextActive && (promotesToAdmin || reactivatesAdmin),
              revokesFullAdministrativeAccess: revokesAdminAccess,
              passwordReset: changedFields.includes("password"),
              activeSessions,
              invalidatedSessions,
            },
          } : {}),
        },
      });
      return { user: updated };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.user);
  } catch (error) {
    if (error instanceof HighRiskAuthorizationError) return error.status === 403 ? authorizationDenied(access.actor, error.message) : NextResponse.json({ error: error.message }, { status: error.status });
    if (isActiveLeadGroupConstraintError(error)) return NextResponse.json({ error: "该小组已经有一位启用中的组长" }, { status: 409 });
    if (isUniqueConstraintError(error)) return NextResponse.json({ error: "登录账号已存在" }, { status: 409 });
    throw error;
  }
}
