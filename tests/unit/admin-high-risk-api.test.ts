import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { hashPassword, verifyPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { PATCH as patchChannel, POST as postChannel } from "../../src/app/api/admin/channels/route";
import { PATCH as patchDepartment } from "../../src/app/api/admin/departments/route";
import { PATCH as patchGroup, POST as postGroup } from "../../src/app/api/admin/groups/route";
import { PATCH as patchUser, POST as postUser } from "../../src/app/api/admin/users/route";

const prefix = "admin-high-risk-";
const currentPassword = "current-admin-password";

async function createActor() {
  const id = `${prefix}actor-${randomUUID()}`;
  const actor = await db.user.create({
    data: {
      id,
      username: id,
      name: "高风险测试管理员",
      passwordHash: hashPassword(currentPassword),
      role: "ADMIN",
    },
  });
  vi.spyOn(auth, "requireRole").mockResolvedValue(actor);
  return actor;
}

async function createDepartmentAndGroup() {
  const departmentId = `${prefix}department-${randomUUID()}`;
  const groupId = `${prefix}group-${randomUUID()}`;
  await db.department.create({ data: { id: departmentId, name: departmentId } });
  await db.teamGroup.create({ data: { id: groupId, name: groupId, departmentId } });
  return { departmentId, groupId };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { startsWith: prefix } },
        { entityId: { startsWith: prefix } },
        { summary: { contains: prefix } },
      ],
    },
  });
  await db.metricEvent.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.customerOrder.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.session.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.deviceAccount.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.device.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("admin high-risk API confirmation", () => {
  it("requires a reason and the current database password before promoting an existing member", async () => {
    const actor = await createActor();
    const { groupId } = await createDepartmentAndGroup();
    const targetId = `${prefix}target-${randomUUID()}`;
    await db.user.create({
      data: {
        id: targetId,
        username: targetId,
        name: "待升级成员",
        passwordHash: hashPassword("member-password"),
        role: "RECEPTION",
        groupId,
      },
    });
    await db.session.create({ data: { id: `${prefix}session-${randomUUID()}`, userId: targetId, expiresAt: new Date(Date.now() + 60_000) } });
    const promotedPassword = "promoted-admin-password";

    const missingReason = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, role: "ADMIN", groupId: null, password: promotedPassword, highRiskReason: "   ", currentPassword }),
    }));
    expect(missingReason.status).toBe(400);
    await expect(missingReason.json()).resolves.toEqual({ error: "请填写操作原因" });

    const shortReason = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, role: "ADMIN", groupId: null, password: promotedPassword, highRiskReason: "调整", currentPassword }),
    }));
    expect(shortReason.status).toBe(400);
    await expect(shortReason.json()).resolves.toEqual({ error: "操作原因至少需要 4 个字" });

    const zeroWidthReason = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, role: "ADMIN", groupId: null, password: promotedPassword, highRiskReason: "\u200b\u200b\u200b\u200b", currentPassword }),
    }));
    expect(zeroWidthReason.status).toBe(400);
    await expect(zeroWidthReason.json()).resolves.toEqual({ error: "请填写操作原因" });

    const controlPaddedReason = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, role: "ADMIN", groupId: null, password: promotedPassword, highRiskReason: "调\u0000整\u200b\u0007", currentPassword }),
    }));
    expect(controlPaddedReason.status).toBe(400);
    await expect(controlPaddedReason.json()).resolves.toEqual({ error: "操作原因至少需要 4 个字" });

    const wrongPassword = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, role: "ADMIN", groupId: null, password: promotedPassword, highRiskReason: "  业务负责人晋升  ", currentPassword: "wrong-password" }),
    }));
    expect(wrongPassword.status).toBe(403);
    await expect(wrongPassword.json()).resolves.toEqual({ error: "当前管理员密码不正确" });
    await expect(db.user.findUniqueOrThrow({ where: { id: targetId }, select: { role: true } })).resolves.toEqual({ role: "RECEPTION" });
    await expect(db.auditLog.count({ where: { entityId: targetId } })).resolves.toBe(0);

    const response = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, role: "ADMIN", groupId: null, password: promotedPassword, highRiskReason: "  业务\u200b负责人   晋升  ", currentPassword }),
    }));
    expect(response.status).toBe(200);
    const promoted = await db.user.findUniqueOrThrow({ where: { id: targetId }, select: { role: true, passwordHash: true } });
    expect(promoted.role).toBe("ADMIN");
    expect(verifyPassword(promotedPassword, promoted.passwordHash)).toBe(true);
    await expect(db.session.count({ where: { userId: targetId } })).resolves.toBe(0);

    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: targetId, action: "MEMBER_ADMIN_GRANTED" } });
    const summary = JSON.parse(audit.summary);
    expect(summary).toMatchObject({
      highRiskReason: "业务 负责人 晋升",
      reauthenticated: true,
      before: { role: "RECEPTION", groupId },
      after: { role: "ADMIN", groupId: null },
      impact: { targetUserId: targetId, previousRole: "RECEPTION", grantsFullAdministrativeAccess: true, passwordReset: true, activeSessions: 1, invalidatedSessions: 1 },
    });
    expect(audit.summary).not.toContain(currentPassword);
    expect(audit.summary).not.toContain(promotedPassword);
    expect(audit.summary).not.toContain("passwordHash");
  });

  it("requires confirmation before resetting an existing ADMIN password, even while demoting that account", async () => {
    const actor = await createActor();
    const { groupId } = await createDepartmentAndGroup();
    const targetId = `${prefix}admin-target-${randomUUID()}`;
    const oldTargetPassword = "old-target-admin-password";
    const newTargetPassword = "new-target-admin-password";
    await db.user.create({
      data: { id: targetId, username: targetId, name: "待重置管理员", passwordHash: hashPassword(oldTargetPassword), role: "ADMIN" },
    });
    await db.session.createMany({
      data: [
        { id: `${prefix}active-session-${randomUUID()}`, userId: targetId, expiresAt: new Date(Date.now() + 60_000) },
        { id: `${prefix}expired-session-${randomUUID()}`, userId: targetId, expiresAt: new Date(Date.now() - 60_000) },
      ],
    });
    const mutation = { id: targetId, role: "RECEPTION", groupId, password: newTargetPassword };

    const missingReason = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ ...mutation, currentPassword }),
    }));
    expect(missingReason.status).toBe(400);
    await expect(missingReason.json()).resolves.toEqual({ error: "请填写操作原因" });

    const wrongPassword = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ ...mutation, highRiskReason: "管理员离岗交接", currentPassword: "wrong-password" }),
    }));
    expect(wrongPassword.status).toBe(403);
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: targetId }, select: { role: true, passwordHash: true } });
    expect(unchanged.role).toBe("ADMIN");
    expect(verifyPassword(oldTargetPassword, unchanged.passwordHash)).toBe(true);

    const response = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ ...mutation, highRiskReason: "管理员离岗交接", currentPassword }),
    }));
    expect(response.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: targetId }, select: { role: true, groupId: true, passwordHash: true } });
    expect(updated).toMatchObject({ role: "RECEPTION", groupId });
    expect(verifyPassword(newTargetPassword, updated.passwordHash)).toBe(true);
    await expect(db.session.count({ where: { userId: targetId } })).resolves.toBe(0);

    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: targetId, action: "MEMBER_ADMIN_ACCESS_REVOKED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      highRiskReason: "管理员离岗交接",
      reauthenticated: true,
      before: { role: "ADMIN", groupId: null },
      after: { role: "RECEPTION", groupId },
      impact: {
        targetUserId: targetId,
        previousRole: "ADMIN",
        grantsFullAdministrativeAccess: false,
        passwordReset: true,
        activeSessions: 1,
        invalidatedSessions: 2,
      },
    });
    for (const secret of [currentPassword, oldTargetPassword, newTargetPassword, "passwordHash"]) {
      expect(audit.summary).not.toContain(secret);
    }
  });

  it("uses the old database password when an administrator resets their own password", async () => {
    const actor = await createActor();
    const newPassword = "new-self-admin-password";
    await db.session.create({ data: { id: `${prefix}self-session-${randomUUID()}`, userId: actor.id, expiresAt: new Date(Date.now() + 60_000) } });

    const response = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: actor.id, password: newPassword, highRiskReason: "定期更换管理密码", currentPassword }),
    }));
    expect(response.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { passwordHash: true } });
    expect(verifyPassword(newPassword, updated.passwordHash)).toBe(true);
    expect(verifyPassword(currentPassword, updated.passwordHash)).toBe(false);
    await expect(db.session.count({ where: { userId: actor.id } })).resolves.toBe(0);

    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: actor.id, action: "MEMBER_ADMIN_PASSWORD_RESET" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      impact: { passwordReset: true, activeSessions: 1, invalidatedSessions: 1 },
    });
    expect(audit.summary).not.toContain(newPassword);
    expect(audit.summary).not.toContain(currentPassword);
  });

  it("requires confirmation before reactivating an inactive ADMIN account", async () => {
    const actor = await createActor();
    const targetId = `${prefix}inactive-admin-${randomUUID()}`;
    await db.user.create({
      data: { id: targetId, username: targetId, name: "待重启管理员", passwordHash: hashPassword("inactive-admin-password"), role: "ADMIN", active: false },
    });
    await db.session.create({ data: { id: `${prefix}inactive-admin-session-${randomUUID()}`, userId: targetId, expiresAt: new Date(Date.now() + 60_000) } });

    const missingReason = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, active: true, currentPassword }),
    }));
    expect(missingReason.status).toBe(400);
    await expect(missingReason.json()).resolves.toEqual({ error: "请填写操作原因" });

    const wrongPassword = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, active: true, highRiskReason: "恢复管理工作", currentPassword: "wrong-password" }),
    }));
    expect(wrongPassword.status).toBe(403);
    await expect(db.user.findUniqueOrThrow({ where: { id: targetId }, select: { active: true } })).resolves.toEqual({ active: false });

    const response = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: targetId, active: true, highRiskReason: "恢复管理工作", currentPassword }),
    }));
    expect(response.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({ where: { id: targetId }, select: { active: true, role: true } })).resolves.toEqual({ active: true, role: "ADMIN" });
    await expect(db.session.count({ where: { userId: targetId } })).resolves.toBe(0);

    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: targetId, action: "MEMBER_ADMIN_REACTIVATED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      before: { role: "ADMIN", active: false },
      after: { role: "ADMIN", active: true },
      impact: {
        grantsAdminRole: false,
        grantsFullAdministrativeAccess: true,
        revokesFullAdministrativeAccess: false,
        activeSessions: 1,
        invalidatedSessions: 1,
      },
    });
  });

  it.each(["deactivate", "demote"] as const)("requires confirmation before %s revokes ADMIN access", async (operation) => {
    const actor = await createActor();
    const { groupId } = await createDepartmentAndGroup();
    const targetId = `${prefix}revoked-admin-${randomUUID()}`;
    await db.user.create({
      data: { id: targetId, username: targetId, name: "待撤权管理员", passwordHash: hashPassword("revoked-admin-password"), role: "ADMIN" },
    });
    await db.session.create({ data: { id: `${prefix}revoked-session-${randomUUID()}`, userId: targetId, expiresAt: new Date(Date.now() + 60_000) } });
    const mutation = operation === "deactivate"
      ? { id: targetId, active: false }
      : { id: targetId, role: "RECEPTION", groupId };

    const denied = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify(mutation),
    }));
    expect(denied.status).toBe(400);
    await expect(denied.json()).resolves.toEqual({ error: "请填写操作原因" });
    await expect(db.user.findUniqueOrThrow({ where: { id: targetId }, select: { role: true, active: true } })).resolves.toEqual({ role: "ADMIN", active: true });

    const response = await patchUser(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ ...mutation, highRiskReason: "撤销管理员权限", currentPassword }),
    }));
    expect(response.status).toBe(200);
    await expect(db.session.count({ where: { userId: targetId } })).resolves.toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: targetId, action: "MEMBER_ADMIN_ACCESS_REVOKED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      before: { role: "ADMIN", active: true },
      impact: { revokesFullAdministrativeAccess: true, activeSessions: 1, invalidatedSessions: 1 },
    });
  });

  it("cannot bypass confirmation by creating a new member directly as ADMIN", async () => {
    const actor = await createActor();
    const username = `${prefix}new-admin-${randomUUID()}`;
    const basePayload = { username, name: "新管理员", password: "new-admin-password", role: "ADMIN", groupId: null };

    const denied = await postUser(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ ...basePayload, highRiskReason: "新增管理员", currentPassword: "wrong-password" }),
    }));
    expect(denied.status).toBe(403);
    await expect(db.user.findUnique({ where: { username } })).resolves.toBeNull();

    const response = await postUser(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ ...basePayload, highRiskReason: "新增运营管理员", currentPassword }),
    }));
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string };
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: created.id, action: "MEMBER_CREATED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      highRiskReason: "新增运营管理员",
      reauthenticated: true,
      before: { exists: false, role: null },
      after: { exists: true, role: "ADMIN" },
      impact: { targetUserId: created.id, grantsFullAdministrativeAccess: true },
    });
    expect(audit.summary).not.toContain("new-admin-password");
  });

  it("checks active child groups and records the impact when disabling a department", async () => {
    const actor = await createActor();
    const blockedDepartmentId = `${prefix}blocked-department-${randomUUID()}`;
    const blockedGroupId = `${prefix}blocked-group-${randomUUID()}`;
    await db.department.create({ data: { id: blockedDepartmentId, name: blockedDepartmentId } });
    await db.teamGroup.create({ data: { id: blockedGroupId, name: blockedGroupId, departmentId: blockedDepartmentId } });

    const blocked = await patchDepartment(new Request("http://localhost/api/admin/departments", {
      method: "PATCH",
      body: JSON.stringify({ id: blockedDepartmentId, active: false, highRiskReason: "部门撤销", currentPassword }),
    }));
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toEqual({ error: "请先停用或移动该公司下的启用小组" });
    await expect(db.department.findUniqueOrThrow({ where: { id: blockedDepartmentId }, select: { active: true } })).resolves.toEqual({ active: true });

    const departmentId = `${prefix}empty-department-${randomUUID()}`;
    await db.department.create({ data: { id: departmentId, name: "待停用空部门" } });
    const response = await patchDepartment(new Request("http://localhost/api/admin/departments", {
      method: "PATCH",
      body: JSON.stringify({ id: departmentId, active: false, highRiskReason: "组织架构调整", currentPassword }),
    }));
    expect(response.status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: departmentId, action: "DEPARTMENT_STATUS_CHANGED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      highRiskReason: "组织架构调整",
      reauthenticated: true,
      before: { active: true },
      after: { active: false },
      impact: { groups: 0, activeGroups: 0, members: 0, activeMembers: 0, channels: 0, activeChannels: 0, sourceBatches: 0 },
    });
    const repeated = await patchDepartment(new Request("http://localhost/api/admin/departments", {
      method: "PATCH",
      body: JSON.stringify({ id: departmentId, active: false }),
    }));
    expect(repeated.status).toBe(200);
    await expect(db.auditLog.count({ where: { entityId: departmentId } })).resolves.toBe(1);
  });

  it("records affected members, channels, and batches when disabling a group", async () => {
    const actor = await createActor();
    const { groupId } = await createDepartmentAndGroup();
    const memberId = `${prefix}member-${randomUUID()}`;
    const channelId = `${prefix}channel-${randomUUID()}`;
    await db.user.create({ data: { id: memberId, username: memberId, name: "受影响成员", passwordHash: "test", role: "RECEPTION", groupId } });
    await db.channel.create({ data: { id: channelId, name: "受影响渠道", normalizedName: channelId, groupId } });
    await db.sourceBatch.create({ data: { id: `${prefix}batch-${randomUUID()}`, groupId, channelId, sourceDate: "2026-08-15" } });

    const missingReason = await patchGroup(new Request("http://localhost/api/admin/groups", {
      method: "PATCH",
      body: JSON.stringify({ id: groupId, active: false, currentPassword }),
    }));
    expect(missingReason.status).toBe(400);
    await expect(db.teamGroup.findUniqueOrThrow({ where: { id: groupId }, select: { active: true } })).resolves.toEqual({ active: true });

    const response = await patchGroup(new Request("http://localhost/api/admin/groups", {
      method: "PATCH",
      body: JSON.stringify({ id: groupId, active: false, highRiskReason: "项目结束停用小组", currentPassword }),
    }));
    expect(response.status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: groupId, action: "GROUP_STATUS_CHANGED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      highRiskReason: "项目结束停用小组",
      reauthenticated: true,
      before: { active: true },
      after: { active: false },
      impact: { members: 1, activeMembers: 1, channels: 1, activeChannels: 1, sourceBatches: 1 },
    });
    const repeated = await patchGroup(new Request("http://localhost/api/admin/groups", {
      method: "PATCH",
      body: JSON.stringify({ id: groupId, active: false }),
    }));
    expect(repeated.status).toBe(200);
    await expect(db.auditLog.count({ where: { entityId: groupId } })).resolves.toBe(1);
  });

  it("requires confirmation before an ADMIN disables a channel", async () => {
    const actor = await createActor();
    const { groupId } = await createDepartmentAndGroup();
    const channelId = `${prefix}toggle-channel-${randomUUID()}`;
    await db.channel.create({
      data: { id: channelId, name: "待停用渠道", normalizedName: channelId, groupId, active: true },
    });
    await db.sourceBatch.create({ data: { id: `${prefix}batch-${randomUUID()}`, groupId, channelId, sourceDate: "2026-08-15" } });

    const denied = await patchChannel(new Request("http://localhost/api/admin/channels", {
      method: "PATCH",
      body: JSON.stringify({ id: channelId, groupId, active: false }),
    }));
    expect(denied.status).toBe(400);
    await expect(db.channel.findUniqueOrThrow({ where: { id_groupId: { id: channelId, groupId } }, select: { active: true } }))
      .resolves.toEqual({ active: true });

    const response = await patchChannel(new Request("http://localhost/api/admin/channels", {
      method: "PATCH",
      body: JSON.stringify({ id: channelId, groupId, active: false, highRiskReason: "停止投放并停用渠道", currentPassword }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ active: false });
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: actor.id, entityId: channelId, action: "CHANNEL_STATUS_CHANGED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      highRiskReason: "停止投放并停用渠道",
      reauthenticated: true,
      before: { name: "待停用渠道", active: true },
      after: { name: "待停用渠道", active: false },
      impact: { sourceBatches: 1 },
    });
    expect(audit.summary).not.toContain(currentPassword);
  });

  it("rejects a channel update payload with no recognized fields", async () => {
    await createActor();
    const response = await patchChannel(new Request("http://localhost/api/admin/channels", {
      method: "PATCH",
      body: JSON.stringify({ id: "channel-1", groupId: "group-a" }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "没有可更新的渠道信息" });
  });

  it("does not allow a group or channel to be re-enabled under a disabled parent", async () => {
    await createActor();
    const { departmentId, groupId } = await createDepartmentAndGroup();
    const channelId = `${prefix}inactive-channel-${randomUUID()}`;
    await db.channel.create({ data: { id: channelId, name: "已停用渠道", normalizedName: channelId, groupId, active: false } });
    await db.teamGroup.update({ where: { id: groupId }, data: { active: false } });
    await db.department.update({ where: { id: departmentId }, data: { active: false } });

    const groupResponse = await patchGroup(new Request("http://localhost/api/admin/groups", {
      method: "PATCH",
      body: JSON.stringify({ id: groupId, active: true }),
    }));
    expect(groupResponse.status).toBe(400);
    await expect(groupResponse.json()).resolves.toEqual({ error: "上级下属公司已停用，不能启用该小组" });

    const channelResponse = await patchChannel(new Request("http://localhost/api/admin/channels", {
      method: "PATCH",
      body: JSON.stringify({ id: channelId, groupId, active: true }),
    }));
    expect(channelResponse.status).toBe(400);
    await expect(channelResponse.json()).resolves.toEqual({ error: "所属小组或部门已停用，不能启用该渠道" });
    await expect(db.teamGroup.findUniqueOrThrow({ where: { id: groupId }, select: { active: true } })).resolves.toEqual({ active: false });
    await expect(db.channel.findUniqueOrThrow({ where: { id_groupId: { id: channelId, groupId } }, select: { active: true } })).resolves.toEqual({ active: false });
  });

  it("rejects new groups, channels, and frontline members after their parent is disabled", async () => {
    await createActor();
    const { departmentId, groupId } = await createDepartmentAndGroup();
    await db.department.update({ where: { id: departmentId }, data: { active: false } });

    const groupName = `${prefix}blocked-new-group-${randomUUID()}`;
    const groupResponse = await postGroup(new Request("http://localhost/api/admin/groups", {
      method: "POST",
      body: JSON.stringify({ name: groupName, departmentId }),
    }));
    expect(groupResponse.status).toBe(400);
    await expect(groupResponse.json()).resolves.toEqual({ error: "请选择启用中的下属公司" });

    const channelName = `${prefix}blocked-new-channel-${randomUUID()}`;
    const channelResponse = await postChannel(new Request("http://localhost/api/admin/channels", {
      method: "POST",
      body: JSON.stringify({ name: channelName, groupId }),
    }));
    expect(channelResponse.status).toBe(400);
    await expect(channelResponse.json()).resolves.toEqual({ error: "只能在启用中的小组创建渠道" });

    const username = `${prefix}blocked-new-member-${randomUUID()}`;
    const memberResponse = await postUser(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, name: "不应创建的成员", password: "member-password", role: "RECEPTION", groupId }),
    }));
    expect(memberResponse.status).toBe(400);
    await expect(memberResponse.json()).resolves.toEqual({ error: "一线岗位和组长必须选择启用中的小组" });

    await expect(db.teamGroup.findFirst({ where: { name: groupName } })).resolves.toBeNull();
    await expect(db.channel.findFirst({ where: { name: channelName } })).resolves.toBeNull();
    await expect(db.user.findUnique({ where: { username } })).resolves.toBeNull();
  });

  it("re-reads the actor inside the transaction so a stale admin session cannot authorize a high-risk action", async () => {
    const actor = await createActor();
    const { groupId } = await createDepartmentAndGroup();
    await db.user.update({ where: { id: actor.id }, data: { active: false } });

    const response = await patchGroup(new Request("http://localhost/api/admin/groups", {
      method: "PATCH",
      body: JSON.stringify({ id: groupId, active: false, highRiskReason: "尝试绕过停用状态", currentPassword }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "当前管理员密码不正确" });
    await expect(db.teamGroup.findUniqueOrThrow({ where: { id: groupId }, select: { active: true } })).resolves.toEqual({ active: true });
  });
});
