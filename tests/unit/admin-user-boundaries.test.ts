import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { hashPassword, verifyPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { PATCH, POST } from "../../src/app/api/admin/users/route";
import { POST as POST_LEAD_MEMBER } from "../../src/app/api/lead/members/route";

const fixturePrefix = "admin-boundary-";
let originalAdminStates: Array<{ id: string; active: boolean }> | null = null;

async function seededAdmin() {
  const admin = await db.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (!admin) throw new Error("测试需要一个启用中的管理员");
  vi.spyOn(auth, "requireRole").mockResolvedValue(admin);
  return admin;
}

async function createInactiveGroupMember() {
  const groupId = `${fixturePrefix}group-${randomUUID()}`;
  const userId = `${fixturePrefix}user-${randomUUID()}`;
  await db.teamGroup.create({ data: { id: groupId, name: "已停用边界测试组", active: false } });
  await db.user.create({
    data: {
      id: userId,
      username: `${fixturePrefix}${randomUUID()}`,
      name: "停用组成员",
      passwordHash: hashPassword("old-password"),
      role: "RECEPTION",
      groupId,
      active: true,
    },
  });
  return { groupId, userId };
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalAdminStates) {
    await Promise.all(originalAdminStates.map(({ id, active }) => db.user.update({ where: { id }, data: { active } })));
    originalAdminStates = null;
  }
  const fixtureUsers = await db.user.findMany({
    where: { OR: [{ id: { startsWith: fixturePrefix } }, { username: { startsWith: fixturePrefix } }] },
    select: { id: true },
  });
  const fixtureIds = fixtureUsers.map(({ id }) => id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: fixtureIds } }, { entityId: { in: fixtureIds } }] } });
  await db.session.deleteMany({ where: { userId: { in: fixtureIds } } });
  await db.user.deleteMany({ where: { id: { in: fixtureIds } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: fixturePrefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: fixturePrefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: fixturePrefix } } });
});

describe.sequential("administrator member boundaries", () => {
  it("allows identity-only edits for an active member whose group is inactive", async () => {
    await seededAdmin();
    const { userId } = await createInactiveGroupMember();

    const response = await PATCH(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: userId, name: "停用组成员新姓名" }),
    }));

    expect(response.status).toBe(200);
    await expect(db.user.findUnique({ where: { id: userId }, select: { name: true } }))
      .resolves.toEqual({ name: "停用组成员新姓名" });
  });

  it("allows password reset in an inactive group, clears sessions, and does not audit the secret", async () => {
    await seededAdmin();
    const { userId } = await createInactiveGroupMember();
    await db.session.create({ data: { id: `${fixturePrefix}session-${randomUUID()}`, userId, expiresAt: new Date(Date.now() + 60_000) } });
    const temporaryPassword = "new-secret-password";

    const response = await PATCH(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: userId, password: temporaryPassword }),
    }));

    expect(response.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, mustChangePassword: true } });
    expect(verifyPassword(temporaryPassword, updated.passwordHash)).toBe(true);
    expect(updated.mustChangePassword).toBe(true);
    await expect(db.session.count({ where: { userId } })).resolves.toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: userId, action: "MEMBER_PASSWORD_RESET" } });
    expect(audit.summary).not.toContain(temporaryPassword);
  });

  it("rejects 6- and 8-character temporary passwords when creating a member", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}group-${randomUUID()}`;
    const username = `${fixturePrefix}${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "短密码测试组" } });

    for (const password of ["123456", "12345678"]) {
      const response = await POST(new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, name: "短密码成员", password, role: "RECEPTION", groupId }),
      }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "临时密码至少需要 12 位" });
    }
    await expect(db.user.findUnique({ where: { username } })).resolves.toBeNull();
  });

  it("creates one account with reception as primary role and group operation as its extra role", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}dual-role-group-${randomUUID()}`;
    const username = `${fixturePrefix}${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "兼任岗位测试组" } });

    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        name: "接粉兼炒群",
        password: "dual-role-password",
        role: "RECEPTION",
        secondaryRoles: ["GROUP_OPERATOR"],
        groupId,
      }),
    }));

    expect(response.status).toBe(201);
    await expect(db.user.findUniqueOrThrow({
      where: { username },
      select: { role: true, mustChangePassword: true, roleAssignments: { select: { role: true }, orderBy: { role: "asc" } } },
    })).resolves.toEqual({
      role: "RECEPTION",
      mustChangePassword: true,
      roleAssignments: [{ role: "GROUP_OPERATOR" }, { role: "RECEPTION" }],
    });
  });

  it("creates a company manager bound to one active subsidiary", async () => {
    const admin = await seededAdmin();
    const departmentId = `${fixturePrefix}company-${randomUUID()}`;
    const username = `${fixturePrefix}${randomUUID()}`;
    await db.department.create({ data: { id: departmentId, name: "边界测试公司" } });

    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        name: "公司管理员",
        password: "company-password",
        role: "COMPANY_MANAGER",
        groupId: null,
        departmentId,
      }),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      username,
      role: "COMPANY_MANAGER",
      groupId: null,
      departmentId,
      department: { id: departmentId, name: "边界测试公司" },
    });
    await expect(db.auditLog.findFirst({
      where: { actorId: admin.id, action: "MEMBER_CREATED", entityType: "User" },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    })).resolves.toMatchObject({ summary: expect.stringContaining("departmentId") });
  });

  it("lets a super administrator create and move a department manager between market scopes", async () => {
    await seededAdmin();
    const departmentId = `${fixturePrefix}scoped-company-${randomUUID()}`;
    const username = `${fixturePrefix}${randomUUID()}`;
    await db.department.create({ data: { id: departmentId, name: "部门权限测试公司", countryCode: "US" } });
    await Promise.all([
      db.teamGroup.create({ data: { id: `${fixturePrefix}us-group-${randomUUID()}`, name: "美国测试组", departmentId, countryCode: "US" } }),
      db.teamGroup.create({ data: { id: `${fixturePrefix}de-group-${randomUUID()}`, name: "德国测试组", departmentId, countryCode: "DE" } }),
    ]);

    const createdResponse = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        name: "市场部门管理员",
        password: "department-password",
        role: "COMPANY_MANAGER",
        departmentId,
        managementScopeName: "美国市场",
        managementCountryCode: "US",
      }),
    }));

    expect(createdResponse.status).toBe(201);
    const created = await db.user.findUniqueOrThrow({ where: { username } });
    expect(created).toMatchObject({ departmentId, managementScopeName: "美国市场", managementCountryCode: "US" });
    await db.session.create({ data: { id: `${fixturePrefix}scope-session-${randomUUID()}`, userId: created.id, expiresAt: new Date(Date.now() + 60_000) } });

    const updatedResponse = await PATCH(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: created.id, departmentId, managementScopeName: "德国市场", managementCountryCode: "DE" }),
    }));

    expect(updatedResponse.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({ where: { id: created.id }, select: { managementScopeName: true, managementCountryCode: true } }))
      .resolves.toEqual({ managementScopeName: "德国市场", managementCountryCode: "DE" });
    await expect(db.session.count({ where: { userId: created.id } })).resolves.toBe(0);
    await expect(db.auditLog.findFirst({ where: { entityId: created.id, action: "DEPARTMENT_MANAGER_SCOPE_UPDATED" } })).resolves.not.toBeNull();
  });

  it("rejects department scope fields on ordinary member accounts", async () => {
    await seededAdmin();
    const { userId } = await createInactiveGroupMember();

    const response = await PATCH(new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: userId, managementScopeName: "伪造市场", managementCountryCode: "US" }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "只有公司管理员角色可以设置部门管理范围" });
    await expect(db.user.findUniqueOrThrow({ where: { id: userId }, select: { managementScopeName: true, managementCountryCode: true } }))
      .resolves.toEqual({ managementScopeName: null, managementCountryCode: null });
  });

  it("creates a resource manager with only the explicitly assigned channels", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}resource-group-${randomUUID()}`;
    const username = `${fixturePrefix}${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "资源渠道绑定测试组" } });
    const channels = await Promise.all([
      db.channel.create({ data: { id: `${fixturePrefix}sms-${randomUUID()}`, groupId, name: "短信", normalizedName: `${fixturePrefix}sms-${randomUUID()}` } }),
      db.channel.create({ data: { id: `${fixturePrefix}ads-${randomUUID()}`, groupId, name: "投流", normalizedName: `${fixturePrefix}ads-${randomUUID()}` } }),
    ]);

    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username,
        name: "短信资源管理员",
        password: "resource-password",
        role: "RESOURCE_MANAGER",
        resourceChannelIds: [channels[0].id],
      }),
    }));

    expect(response.status).toBe(201);
    await expect(db.user.findUniqueOrThrow({
      where: { username },
      select: { resourceChannelAccess: { select: { channelId: true } } },
    })).resolves.toEqual({ resourceChannelAccess: [{ channelId: channels[0].id }] });
  });

  it("rejects a resource manager without any assigned channel", async () => {
    await seededAdmin();
    const username = `${fixturePrefix}${randomUUID()}`;
    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, name: "无渠道资源管理员", password: "resource-password", role: "RESOURCE_MANAGER", resourceChannelIds: [] }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "资源部管理员必须选择至少一个可见渠道" });
  });

  it("rejects a company manager without an active subsidiary", async () => {
    await seededAdmin();
    const departmentId = `${fixturePrefix}inactive-company-${randomUUID()}`;
    const username = `${fixturePrefix}${randomUUID()}`;
    await db.department.create({ data: { id: departmentId, name: "已停用测试公司", active: false } });

    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, name: "无范围管理员", password: "company-password", role: "COMPANY_MANAGER", departmentId }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "公司管理员必须选择启用中的下属公司" });
    await expect(db.user.findUnique({ where: { username } })).resolves.toBeNull();
  });

  it("allows only one active lead in each group", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}single-lead-group-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "单组长测试组" } });
    await db.user.create({
      data: {
        id: `${fixturePrefix}lead-${randomUUID()}`,
        username: `${fixturePrefix}${randomUUID()}`,
        name: "现任组长",
        passwordHash: hashPassword("lead-password"),
        role: "LEAD",
        groupId,
      },
    });

    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: `${fixturePrefix}${randomUUID()}`,
        name: "第二位组长",
        password: "lead-password",
        role: "LEAD",
        groupId,
      }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "该小组已经有一位启用中的组长" });
    await expect(db.user.count({ where: { role: "LEAD", active: true, groupId } })).resolves.toBe(1);
  });

  it("allows a replacement lead after the previous lead is disabled", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}replacement-lead-group-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "更换组长测试组" } });
    await db.user.create({
      data: {
        id: `${fixturePrefix}inactive-lead-${randomUUID()}`,
        username: `${fixturePrefix}${randomUUID()}`,
        name: "前任组长",
        passwordHash: hashPassword("lead-password"),
        role: "LEAD",
        groupId,
        active: false,
      },
    });

    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: `${fixturePrefix}${randomUUID()}`,
        name: "新任组长",
        password: "lead-password",
        role: "LEAD",
        groupId,
      }),
    }));

    expect(response.status).toBe(201);
    await expect(db.user.count({ where: { role: "LEAD", active: true, groupId } })).resolves.toBe(1);
  });

  it("keeps an active administrator when two administrators concurrently disable each other", async () => {
    const passwordHash = hashPassword("admin-password");
    const first = await db.user.create({ data: { id: `${fixturePrefix}admin-a-${randomUUID()}`, username: `${fixturePrefix}${randomUUID()}`, name: "边界管理员 A", passwordHash, role: "ADMIN" } });
    const second = await db.user.create({ data: { id: `${fixturePrefix}admin-b-${randomUUID()}`, username: `${fixturePrefix}${randomUUID()}`, name: "边界管理员 B", passwordHash, role: "ADMIN" } });
    originalAdminStates = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true, active: true } });
    await db.user.updateMany({ where: { role: "ADMIN" }, data: { active: false } });
    await db.user.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { active: true } });
    vi.spyOn(auth, "requireRole").mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    await Promise.all([
      PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: second.id, active: false, highRiskReason: "并发调整管理员", currentPassword: "admin-password" }) })),
      PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: first.id, active: false, highRiskReason: "并发调整管理员", currentPassword: "admin-password" }) })),
    ]);

    await expect(db.user.count({ where: { id: { in: [first.id, second.id] }, role: "ADMIN", active: true } })).resolves.toBe(1);
  });

  it("updates employment fields and records the before and after stage audit", async () => {
    const admin = await seededAdmin();
    const groupId = `${fixturePrefix}employment-group-${randomUUID()}`;
    const userId = `${fixturePrefix}employment-user-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "员工阶段测试组" } });
    await db.user.create({ data: { id: userId, username: `${fixturePrefix}${randomUUID()}`, name: "阶段测试成员", passwordHash: hashPassword("member-password"), role: "RECEPTION", groupId } });
    const response = await PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: userId, hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "延长观察以补足样本" }) }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: userId, hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "延长观察以补足样本" });
    const updated = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { hireDate: true, stageOverride: true, stageOverrideReason: true, stageOverrideAt: true } });
    expect(updated).toMatchObject({ hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "延长观察以补足样本" });
    expect(updated.stageOverrideAt).toBeInstanceOf(Date);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: admin.id, entityId: userId, action: "USER_EMPLOYMENT_UPDATED" } });
    expect(JSON.parse(audit.summary)).toEqual({ changedFields: ["hireDate", "stageOverride", "stageOverrideReason"], name: "阶段测试成员", before: { hireDate: null, stageOverride: null, stageOverrideReason: null }, after: { hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "延长观察以补足样本" } });
  });

  it("audits an employment override selected while an administrator creates a member", async () => {
    const admin = await seededAdmin();
    const groupId = `${fixturePrefix}create-employment-group-${randomUUID()}`;
    const username = `${fixturePrefix}${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "新建阶段测试组" } });

    const response = await POST(new Request("http://localhost/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, name: "新建阶段成员", password: "member-password", role: "RECEPTION", groupId, hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "延长观察以补足样本" }),
    }));

    expect(response.status).toBe(201);
    const member = await response.json() as { id: string };
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: admin.id, entityId: member.id, action: "USER_EMPLOYMENT_UPDATED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({
      changedFields: ["hireDate", "stageOverride", "stageOverrideReason"],
      before: { hireDate: null, stageOverride: null, stageOverrideReason: null },
      after: { hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "延长观察以补足样本" },
    });
  });

  it("preserves the override timestamp when only the hire date changes", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}hire-date-group-${randomUUID()}`;
    const userId = `${fixturePrefix}hire-date-user-${randomUUID()}`;
    const stageOverrideAt = new Date("2026-08-01T00:00:00.000Z");
    await db.teamGroup.create({ data: { id: groupId, name: "入职日期测试组" } });
    await db.user.create({ data: { id: userId, username: `${fixturePrefix}${randomUUID()}`, name: "入职日期成员", passwordHash: hashPassword("member-password"), role: "RECEPTION", groupId, hireDate: "2026-07-01", stageOverride: "PAUSED", stageOverrideReason: "暂停阶段评价", stageOverrideAt } });

    const response = await PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: userId, hireDate: "2026-07-02" }) }));

    expect(response.status).toBe(200);
    await expect(db.user.findUnique({ where: { id: userId }, select: { stageOverrideAt: true, stageOverrideReason: true } })).resolves.toEqual({ stageOverrideAt, stageOverrideReason: "暂停阶段评价" });
  });

  it("clears the override reason and timestamp when the administrator clears the override", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}clear-group-${randomUUID()}`;
    const userId = `${fixturePrefix}clear-user-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "清除阶段测试组" } });
    await db.user.create({ data: { id: userId, username: `${fixturePrefix}${randomUUID()}`, name: "待清除阶段成员", passwordHash: hashPassword("member-password"), role: "RECEPTION", groupId, hireDate: "2026-07-01", stageOverride: "PAUSED", stageOverrideReason: "暂停阶段评价", stageOverrideAt: new Date("2026-08-01T00:00:00.000Z") } });
    const response = await PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: userId, stageOverride: null, stageOverrideReason: "不应保留" }) }));
    expect(response.status).toBe(200);
    await expect(db.user.findUnique({ where: { id: userId }, select: { stageOverride: true, stageOverrideReason: true, stageOverrideAt: true } })).resolves.toEqual({ stageOverride: null, stageOverrideReason: null, stageOverrideAt: null });
  });

  it("rejects a stage override whose reason has fewer than four trimmed characters", async () => {
    await seededAdmin();
    const response = await PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: "member-1", stageOverride: "OBSERVATION", stageOverrideReason: "延长观" }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "手动阶段原因至少需要 4 个字" });
  });

  it.each(["LEAD", "RECEPTION"])("returns 403 when a %s forges an administrator employment update", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new auth.AuthorizationError(undefined, { id: "denied-user", groupId: "denied-team" } as never));
    const response = await PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: "member-1", hireDate: "2026-08-01" }) }));
    expect(response.status).toBe(403);
  });

  it("does not let the lead member-creation endpoint accept employment fields", async () => {
    const lead = await db.user.findFirstOrThrow({ where: { role: "LEAD", active: true } });
    vi.spyOn(auth, "requireRole").mockResolvedValue(lead);
    const username = `${fixturePrefix}${randomUUID()}`;
    const response = await POST_LEAD_MEMBER(new Request("http://localhost/api/lead/members", { method: "POST", body: JSON.stringify({ username, name: "越权阶段成员", password: "member-password", hireDate: "2026-08-01", stageOverride: "FORMAL", stageOverrideReason: "越权指定正式" }) }));
    expect(response.status).toBe(403);
    await expect(db.user.findUnique({ where: { username } })).resolves.toBeNull();
  });
});
