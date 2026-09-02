import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { deleteEmptyAccount } from "../../../../lib/account-deletion";
import { db } from "../../../../lib/db";
import {
  getActiveLeadGroup,
  requireLeadRequest,
  safeLeadMemberSelect,
} from "../../../../lib/lead-members";
import { isUniqueConstraintError } from "../../admin/users/validation";
import { applyHackerGroupDefaultRoles, parseFrontlineSecondaryRoles } from "../../../../lib/role-assignments";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied, type SecurityEventActor } from "../../../../lib/security-events";
import { getSystemSettings } from "../../../../lib/settings";
import { resolveGroupBusinessDate } from "../../../../lib/business-time";
import { replaceReceptionistGroupOperatorAssignment } from "../../../../lib/group-operator-collaboration";
import { customerCurrentGroupWhere } from "../../../../lib/customer-current-group";

type MemberRequest = {
  id?: unknown;
  username?: unknown;
  name?: unknown;
  password?: unknown;
  role?: unknown;
  secondaryRoles?: unknown;
  groupId?: unknown;
  active?: unknown;
  hireDate?: unknown;
  stageOverride?: unknown;
  stageOverrideReason?: unknown;
  pairedGroupOperatorId?: unknown;
};

type RequestedMemberUpdate = {
  username?: string;
  employeeCode?: string;
  name?: string;
  passwordHash?: string;
  active?: boolean;
  role?: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  secondaryRoles?: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT"[];
};

const frontlineRoles = new Set(["RECEPTION", "GROUP_OPERATOR", "EXPERT"]);

function isMemberRequest(body: unknown): body is MemberRequest {
  return Boolean(body) && typeof body === "object" && !Array.isArray(body);
}

function hasForbiddenGroupField(body: MemberRequest): boolean {
  return Object.prototype.hasOwnProperty.call(body, "groupId");
}

function forbiddenGroupFieldResponse() {
  return NextResponse.json(
    { error: "不允许修改所属小组" },
    { status: 400 },
  );
}

function hasAdminOnlyEmploymentField(body: MemberRequest): boolean {
  return (
    Object.prototype.hasOwnProperty.call(body, "hireDate") ||
    Object.prototype.hasOwnProperty.call(body, "stageOverride") ||
    Object.prototype.hasOwnProperty.call(body, "stageOverrideReason")
  );
}

function adminOnlyEmploymentFieldResponse(actor: SecurityEventActor) {
  return authorizationDenied(actor, "只有管理员可以修改入职日期和员工阶段");
}

function parsePairing(body: MemberRequest) {
  const included = Object.prototype.hasOwnProperty.call(body, "pairedGroupOperatorId");
  if (!included) return { included: false as const, value: null };
  if (body.pairedGroupOperatorId === null || body.pairedGroupOperatorId === "") {
    return { included: true as const, value: null };
  }
  if (typeof body.pairedGroupOperatorId !== "string" || body.pairedGroupOperatorId.length > API_LIMITS.identifierCharacters) {
    return null;
  }
  return { included: true as const, value: body.pairedGroupOperatorId };
}

async function isActiveGroupOperator(
  client: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  userId: string,
  groupId: string,
) {
  const operator = await client.user.findFirst({
    where: {
      id: userId,
      groupId,
      active: true,
      OR: [
        { role: "GROUP_OPERATOR" },
        { roleAssignments: { some: { role: "GROUP_OPERATOR" } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(operator);
}

export async function GET() {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;

  const result = await db.$transaction(
    async (client) => {
      const group = await getActiveLeadGroup(access.actor.id, client);
      if (!group)
        return { error: "组长必须归属启用中的小组", status: 403 as const };

      const members = await client.user.findMany({
        where: {
          groupId: group.id,
          OR: [
            { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
            { roleAssignments: { some: { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } } } },
          ],
        },
        select: safeLeadMemberSelect,
        orderBy: { createdAt: "desc" },
      });
      const settings = await getSystemSettings();
      const businessDate = await resolveGroupBusinessDate(group.id, settings.timezone, new Date(), client);
      const memberIds = members.map((member) => member.id);
      const [customers, devices, accounts, filledEntries] = memberIds.length ? await Promise.all([
        client.leadCustomer.findMany({
          where: { AND: [customerCurrentGroupWhere(group.id)], invalid: false, leftOn: null, receptionArchivedAt: null },
          select: { ownerId: true, joinedOn: true, groupOperatorOwnerId: true, expertIntroducedOn: true, expertOwnerId: true, expertWorkflowStage: true },
        }),
        client.device.findMany({ where: { groupId: group.id, memberId: { in: memberIds } }, select: { memberId: true } }),
        client.deviceAccount.findMany({ where: { groupId: group.id, ownerId: { in: memberIds } }, select: { ownerId: true } }),
        client.dailyStatEntry.findMany({ where: { groupId: group.id, ownerId: { in: memberIds }, businessDate, approvedRevisionId: { not: null } }, distinct: ["ownerId"], select: { ownerId: true } }),
      ]) : [[], [], [], []];
      const clientCounts = new Map<string, number>();
      const addClient = (id: string | null) => { if (id && memberIds.includes(id)) clientCounts.set(id, (clientCounts.get(id) ?? 0) + 1); };
      for (const customer of customers) {
        if (!customer.joinedOn) addClient(customer.ownerId);
        else if (!customer.expertIntroducedOn) addClient(customer.groupOperatorOwnerId);
        else if (customer.expertWorkflowStage !== "STALLED" && customer.expertWorkflowStage !== "DECLINED_DEPOSIT") addClient(customer.expertOwnerId);
      }
      const deviceCounts = new Map<string, number>();
      for (const device of devices) if (device.memberId) deviceCounts.set(device.memberId, (deviceCounts.get(device.memberId) ?? 0) + 1);
      for (const account of accounts) deviceCounts.set(account.ownerId, (deviceCounts.get(account.ownerId) ?? 0) + 1);
      const filledIds = new Set(filledEntries.map((entry) => entry.ownerId));
      return { members: members.map((member) => ({ ...member, filledToday: filledIds.has(member.id), clients: clientCounts.get(member.id) ?? 0, devices: deviceCounts.get(member.id) ?? 0 })) };
    },
    { isolationLevel: "Serializable" },
  );

  if ("error" in result)
    return result.status === 403
      ? authorizationDenied(access.actor, result.error)
      : NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.members);
}

export async function POST(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;

  const body = await request.json();
  if (!isMemberRequest(body)) {
    return NextResponse.json({ error: "请完整填写成员信息" }, { status: 400 });
  }
  if (hasForbiddenGroupField(body)) return forbiddenGroupFieldResponse();
  if (hasAdminOnlyEmploymentField(body))
    return adminOnlyEmploymentFieldResponse(access.actor);

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role =
    typeof body.role === "string" && frontlineRoles.has(body.role)
      ? (body.role as RequestedMemberUpdate["role"])
      : body.role === undefined
        ? "RECEPTION"
        : null;
  if (!username || !name || !password || !role) {
    return NextResponse.json({ error: "请完整填写成员信息" }, { status: 400 });
  }
  if (username.length > API_LIMITS.loginUsernameCharacters || name.length > API_LIMITS.accountDisplayNameCharacters || password.length > API_LIMITS.loginPasswordCharacters) {
    return NextResponse.json({ error: "账号、姓名或密码长度超过限制" }, { status: 400 });
  }
  const secondaryRoles = parseFrontlineSecondaryRoles(role, body.secondaryRoles);
  if (!secondaryRoles.success)
    return NextResponse.json({ error: secondaryRoles.error }, { status: 400 });
  if (password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { error: `临时密码至少需要 ${PASSWORD_MIN_LENGTH} 位` },
      { status: 400 },
    );
  }
  const pairing = parsePairing(body);
  if (!pairing) return NextResponse.json({ error: "配对炒群参数不正确" }, { status: 400 });
  const settings = await getSystemSettings();
  const now = new Date();
  const memberId = randomUUID();

  try {
    const result = await db.$transaction(
      async (client) => {
        const group = await getActiveLeadGroup(access.actor.id, client);
        if (!group)
          return { error: "组长必须归属启用中的小组", status: 403 as const };
        const effectiveSecondaryRoles = applyHackerGroupDefaultRoles(role, secondaryRoles.value, group.groupType);
        const assignedRoles = new Set([role, ...effectiveSecondaryRoles]);
        if (pairing.value && !assignedRoles.has("RECEPTION")) {
          return { error: "只有接粉岗位可以设置配对炒群", status: 400 as const };
        }
        const effectiveFrom = await resolveGroupBusinessDate(group.id, settings.timezone, now, client);
        const pairingOperatorId = pairing.value ?? (
          pairing.included && assignedRoles.has("RECEPTION") && assignedRoles.has("GROUP_OPERATOR")
            ? memberId
            : null
        );
        if (pairingOperatorId && pairingOperatorId !== memberId && !await isActiveGroupOperator(client, pairingOperatorId, group.id)) {
          return { error: "只能配对本组启用中的炒群员", status: 400 as const };
        }

        const member = await client.user.create({
          data: {
            id: memberId,
            employeeCode: username,
            username,
            name,
            passwordHash: hashPassword(password),
            mustChangePassword: true,
            role,
            groupId: group.id,
            roleAssignments: { create: [role, ...effectiveSecondaryRoles].map((assignedRole) => ({ role: assignedRole })) },
            membershipHistory: { create: { groupId: group.id, role, secondaryRoles: effectiveSecondaryRoles.join(",") || null, effectiveFrom, reason: "组长创建成员", createdById: access.actor.id } },
          },
          select: safeLeadMemberSelect,
        });
        if (pairing.included && assignedRoles.has("RECEPTION")) {
          await replaceReceptionistGroupOperatorAssignment({
            tx: client,
            receptionistId: member.id,
            groupOperatorId: pairingOperatorId,
            actorId: access.actor.id,
            reason: "组长开通账号时设置配对",
          });
        }
        await recordAudit(client, {
          actorId: access.actor.id,
          action: "MEMBER_CREATED",
          entityType: "User",
          entityId: member.id,
          summary: { changedFields: ["name", "username", "role", "groupId"] },
        });
        return { member };
      },
      { isolationLevel: "Serializable" },
    );

    if ("error" in result)
      return result.status === 403
        ? authorizationDenied(access.actor, result.error)
        : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.member, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "登录账号已存在" }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;

  const body = await request.json();
  if (!isMemberRequest(body)) {
    return NextResponse.json({ error: "成员参数不正确" }, { status: 400 });
  }
  if (hasForbiddenGroupField(body)) return forbiddenGroupFieldResponse();
  if (hasAdminOnlyEmploymentField(body))
    return adminOnlyEmploymentFieldResponse(access.actor);
  if (typeof body.id !== "string" || !body.id || body.id.length > API_LIMITS.identifierCharacters) {
    return NextResponse.json({ error: "成员参数不正确" }, { status: 400 });
  }
  const pairing = parsePairing(body);
  if (!pairing) return NextResponse.json({ error: "配对炒群参数不正确" }, { status: 400 });

  const requested: RequestedMemberUpdate = {};
  if (typeof body.username === "string") {
    const username = body.username.trim();
    if (!username || username.length > API_LIMITS.loginUsernameCharacters)
      return NextResponse.json({ error: "登录账号不能为空且不能超过 200 个字" }, { status: 400 });
    requested.username = username;
  }
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > API_LIMITS.accountDisplayNameCharacters)
      return NextResponse.json({ error: "成员姓名不能为空且不能超过 100 个字" }, { status: 400 });
    requested.name = name;
  }
  if (typeof body.active === "boolean") {
    requested.active = body.active;
  }
  if (typeof body.role === "string") {
    if (!frontlineRoles.has(body.role))
      return NextResponse.json({ error: "岗位不正确" }, { status: 400 });
    requested.role = body.role as RequestedMemberUpdate["role"];
  }
  const includesSecondaryRoles = Object.prototype.hasOwnProperty.call(body, "secondaryRoles");
  if (includesSecondaryRoles && !Array.isArray(body.secondaryRoles))
    return NextResponse.json({ error: "兼任岗位参数不正确" }, { status: 400 });
  if (requested.role !== undefined) {
    return NextResponse.json({ error: "岗位变化必须使用“人员调岗与跨组调动”，不能直接覆盖岗位历史" }, { status: 400 });
  }
  if (typeof body.password === "string") {
    if (body.password.length < PASSWORD_MIN_LENGTH || body.password.length > API_LIMITS.loginPasswordCharacters) {
      return NextResponse.json(
        { error: `临时密码长度必须在 ${PASSWORD_MIN_LENGTH} 到 ${API_LIMITS.loginPasswordCharacters} 位之间` },
        { status: 400 },
      );
    }
    requested.passwordHash = hashPassword(body.password);
  }
  if (!Object.keys(requested).length && !includesSecondaryRoles && !pairing.included) {
    return NextResponse.json(
      { error: "没有可更新的成员信息" },
      { status: 400 },
    );
  }

  try {
    const result = await db.$transaction(
      async (client) => {
        const group = await getActiveLeadGroup(access.actor.id, client);
        if (!group)
          return { error: "组长必须归属启用中的小组", status: 403 as const };

        const existing = await client.user.findFirst({
          where: {
            id: body.id as string,
            groupId: group.id,
            OR: [
              { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
              { roleAssignments: { some: { role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] } } } },
            ],
          },
          select: {
            id: true,
            employeeCode: true,
            username: true,
            name: true,
            active: true,
            role: true,
            roleAssignments: { select: { role: true } },
          },
        });
        if (!existing) return { error: "无权管理该组员", status: 403 as const };

        const data: RequestedMemberUpdate = {};
        const changedFields: string[] = [];
        if (
          requested.username !== undefined &&
          requested.username !== existing.username
        ) {
          data.username = requested.username;
          changedFields.push("username");
          // 组长创建成员时 employeeCode 默认就是当时的用户名。若两者仍相同，
          // 说明这是一次创建资料纠错，应同步修正人员代号；自定义过的代号则保持不动。
          if (existing.employeeCode === existing.username) {
            data.employeeCode = requested.username;
            changedFields.push("employeeCode");
          }
        }
        if (requested.name !== undefined && requested.name !== existing.name) {
          data.name = requested.name;
          changedFields.push("name");
        }
        if (
          requested.active !== undefined &&
          requested.active !== existing.active
        ) {
          data.active = requested.active;
          changedFields.push("active");
        }
        if (
          requested.role !== undefined &&
          requested.role !== existing.role
        ) {
          data.role = requested.role;
          changedFields.push("role");
        }
        if (requested.passwordHash !== undefined) {
          data.passwordHash = requested.passwordHash;
          changedFields.push("password");
        }
        const nextRole = data.role ?? existing.role;
        const currentSecondaryRoles = existing.roleAssignments.map((assignment) => assignment.role).filter((assignedRole) => assignedRole !== existing.role);
        const requestedSecondaryRoles = includesSecondaryRoles
          ? body.secondaryRoles
          : nextRole === existing.role ? currentSecondaryRoles : [];
        const parsedSecondaryRoles = parseFrontlineSecondaryRoles(nextRole, requestedSecondaryRoles);
        if (!parsedSecondaryRoles.success)
          return { error: parsedSecondaryRoles.error, status: 400 as const };
        const nextSecondaryRoles = applyHackerGroupDefaultRoles(nextRole, parsedSecondaryRoles.value, group.groupType);
        if (includesSecondaryRoles && currentSecondaryRoles.some((assignedRole) => !nextSecondaryRoles.includes(assignedRole))) {
          return { error: "已有岗位不能在这里关闭；请使用“人员调岗与跨组调动”", status: 400 as const };
        }
        const roleAssignmentsChanged = nextRole !== existing.role
          || currentSecondaryRoles.length !== nextSecondaryRoles.length
          || currentSecondaryRoles.some((assignedRole) => !nextSecondaryRoles.includes(assignedRole));
        if (roleAssignmentsChanged) changedFields.push("secondaryRoles");
        const nextAssignedRoles = new Set([nextRole, ...nextSecondaryRoles]);
        if (pairing.value && !nextAssignedRoles.has("RECEPTION")) {
          return { error: "只有接粉岗位可以设置配对炒群", status: 400 as const };
        }
        const shouldUpdatePairing = pairing.included || !nextAssignedRoles.has("RECEPTION");
        const nextOperatorId = nextAssignedRoles.has("RECEPTION") ? pairing.value : null;
        if (pairing.value) {
          const validOperator = pairing.value === existing.id
            ? nextAssignedRoles.has("GROUP_OPERATOR")
            : await isActiveGroupOperator(client, pairing.value, group.id);
          if (!validOperator) return { error: "只能配对本组启用中的炒群员", status: 400 as const };
        }
        if (shouldUpdatePairing) changedFields.push("pairedGroupOperatorId");
        if (!changedFields.length) {
          return { error: "没有可更新的成员信息", status: 400 as const };
        }

        const member = await client.user.update({
          where: { id: existing.id },
          data: {
            ...data,
            ...(data.passwordHash ? { mustChangePassword: true } : {}),
            ...(roleAssignmentsChanged ? { roleAssignments: { deleteMany: {}, create: [nextRole, ...nextSecondaryRoles].map((assignedRole) => ({ role: assignedRole })) } } : {}),
          },
          select: safeLeadMemberSelect,
        });
        if (shouldUpdatePairing) {
          await replaceReceptionistGroupOperatorAssignment({
            tx: client,
            receptionistId: existing.id,
            groupOperatorId: nextOperatorId,
            actorId: access.actor.id,
            reason: nextAssignedRoles.has("RECEPTION") ? "组长设置岗位时同步调整配对" : "成员不再担任接粉，关闭当前配对",
          });
        }
        if (data.passwordHash) {
          await client.session.deleteMany({ where: { userId: existing.id } });
        }
        const action = changedFields.includes("password")
          ? "MEMBER_PASSWORD_RESET"
          : changedFields.includes("active")
            ? "MEMBER_STATUS_CHANGED"
            : "MEMBER_UPDATED";
        await recordAudit(client, {
          actorId: access.actor.id,
          action,
          entityType: "User",
          entityId: existing.id,
          summary: { changedFields },
        });
        return { member };
      },
      { isolationLevel: "Serializable" },
    );

    if ("error" in result)
      return result.status === 403
        ? authorizationDenied(access.actor, result.error)
        : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.member);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "登录账号已存在" }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const body = await request.json() as { id?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || id.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "成员参数不正确" }, { status: 400 });

  const group = await getActiveLeadGroup(access.actor.id);
  if (!group) return authorizationDenied(access.actor, "组长必须归属启用中的小组");
  const target = await db.user.findFirst({
    where: {
      id,
      groupId: group.id,
      role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
    },
    select: { id: true, name: true },
  });
  if (!target) return authorizationDenied(access.actor, "无权删除该组员账号");

  const result = await deleteEmptyAccount({ actorId: access.actor.id, targetId: target.id, targetName: target.name });
  if (!result.deleted) return NextResponse.json({ error: result.error }, { status: result.status === 409 ? 409 : 400 });
  return NextResponse.json({ deleted: true });
}
