import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { resolveGroupBusinessDate } from "../../../../lib/business-time";
import { db } from "../../../../lib/db";
import { canCreateGroupLeadAccount, type GroupScope } from "../../../../lib/org-permissions";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";
import { isActiveLeadGroupConstraintError, isUniqueConstraintError } from "../../admin/users/validation";
import { requireAdminOrOrgManagerRequest } from "../_auth";

type GroupLeadAccountRequest = {
  groupId?: unknown;
  username?: unknown;
  name?: unknown;
  password?: unknown;
  effectiveOn?: unknown;
};

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year
    && normalized.getUTCMonth() === month - 1
    && normalized.getUTCDate() === day;
}

/**
 * 给一个已经存在且组长空缺的小组开设全新组长账号。
 *
 * 这条路由和 groups/[groupId]/lead 的职责不同：后者只任命/调动现有人员；这里创建新的
 * User、绑定目标小组、写入首次归属历史和审计记录。全部动作在同一个 Serializable 事务
 * 里完成，任何一步失败都不会留下“账号存在但没有小组”的半成品。
 */
export async function POST(request: Request) {
  const access = await requireAdminOrOrgManagerRequest();
  if ("response" in access) return access.response;

  const body = await request.json() as GroupLeadAccountRequest;
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const effectiveOn = body.effectiveOn;

  if (!groupId || groupId.length > API_LIMITS.identifierCharacters)
    return NextResponse.json({ error: "请选择启用中的小组" }, { status: 400 });
  if (!username || !name || !password)
    return NextResponse.json({ error: "请完整填写账号、姓名和临时密码" }, { status: 400 });
  if (username.length > API_LIMITS.loginUsernameCharacters
    || name.length > API_LIMITS.accountDisplayNameCharacters
    || password.length > API_LIMITS.loginPasswordCharacters)
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH)
    return NextResponse.json({ error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });
  if (!isDateOnly(effectiveOn))
    return NextResponse.json({ error: "请选择正确的生效日期" }, { status: 400 });

  const settings = await getSystemSettings();
  const now = new Date();
  const userId = randomUUID();

  try {
    const result = await db.$transaction(async (client) => {
      const group = await client.teamGroup.findFirst({
        where: { id: groupId, active: true, department: { active: true } },
        select: {
          id: true,
          name: true,
          departmentId: true,
          department: { select: { companyId: true } },
        },
      });
      if (!group) return { error: "请选择启用中的小组", status: 400 as const };

      const scope: GroupScope = {
        id: group.id,
        departmentId: group.departmentId,
        companyId: group.department.companyId,
      };
      if (!canCreateGroupLeadAccount(access.actor, scope)) return { denied: true as const };

      const businessDate = await resolveGroupBusinessDate(group.id, settings.timezone, now, client);
      if (effectiveOn > businessDate)
        return { error: `生效日期不能晚于目标小组当地今天 ${businessDate}`, status: 400 as const };

      const existingLead = await client.user.findFirst({
        where: { role: "LEAD", active: true, groupId: group.id },
        select: { id: true },
      });
      if (existingLead) return { error: "该小组已经有一位启用中的组长，请使用任免或调动流程", status: 409 as const };

      const lead = await client.user.create({
        data: {
          id: userId,
          employeeCode: `OGL-${randomUUID().slice(0, 8).toUpperCase()}`,
          username,
          name,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          role: "LEAD",
          duty: "LEAD",
          groupId: group.id,
          hireDate: effectiveOn,
          roleAssignments: { create: [{ role: "LEAD" }] },
          membershipHistory: {
            create: {
              groupId: group.id,
              role: "LEAD",
              effectiveFrom: effectiveOn,
              reason: "组织管理员创建组长账号",
              createdById: access.actor.id,
            },
          },
        },
        select: {
          id: true,
          employeeCode: true,
          username: true,
          name: true,
          role: true,
          duty: true,
          groupId: true,
          hireDate: true,
          active: true,
          mustChangePassword: true,
        },
      });

      await recordAudit(client, {
        actorId: access.actor.id,
        action: "ORG_GROUP_LEAD_ACCOUNT_CREATED",
        entityType: "User",
        entityId: lead.id,
        summary: {
          changedFields: ["username", "name", "role", "duty", "groupId", "hireDate"],
          companyId: group.department.companyId,
          departmentId: group.departmentId,
          groupId: group.id,
          groupName: group.name,
          effectiveOn,
        },
      });

      return { lead };
    }, { isolationLevel: "Serializable" });

    if ("denied" in result) return authorizationDenied(access.actor, "没有权限给这个小组创建组长账号");
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.lead, { status: 201 });
  } catch (error) {
    if (isActiveLeadGroupConstraintError(error))
      return NextResponse.json({ error: "该小组已经有一位启用中的组长，请使用任免或调动流程" }, { status: 409 });
    if (isUniqueConstraintError(error))
      return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
    throw error;
  }
}
