import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { AuthorizationError, hashPassword, verifyPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST as postGroup, PATCH as patchGroup } from "../../src/app/api/company/groups/route";
import { POST as postLead, PATCH as patchLead } from "../../src/app/api/company/leads/route";
import { POST as postDepartmentManager } from "../../src/app/api/company/department-managers/route";

const prefix = "company-org-test-";

async function fixture() {
  const ownCompanyId = `${prefix}own-${randomUUID()}`;
  const otherCompanyId = `${prefix}other-${randomUUID()}`;
  const managerId = `${prefix}manager-${randomUUID()}`;
  await db.department.createMany({ data: [{ id: ownCompanyId, name: `本公司-${randomUUID()}` }, { id: otherCompanyId, name: `其他公司-${randomUUID()}` }] });
  const manager = await db.user.create({ data: { id: managerId, username: managerId, name: "公司管理员", passwordHash: hashPassword("manager-password"), role: "COMPANY_MANAGER", departmentId: ownCompanyId } });
  vi.spyOn(auth, "requireRole").mockResolvedValue(manager);
  const ownGroup = await db.teamGroup.create({ data: { id: `${prefix}own-group-${randomUUID()}`, name: "本公司一组", departmentId: ownCompanyId } });
  const otherGroup = await db.teamGroup.create({ data: { id: `${prefix}other-group-${randomUUID()}`, name: "其他公司一组", departmentId: otherCompanyId } });
  return { manager, ownCompanyId, otherCompanyId, ownGroup, otherGroup };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({ where: { OR: [{ id: { startsWith: prefix } }, { username: { startsWith: prefix } }] }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }, { entityId: { startsWith: prefix } }] } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  const groups = await db.teamGroup.findMany({ where: { OR: [{ id: { startsWith: prefix } }, { departmentId: { startsWith: prefix } }] }, select: { id: true } });
  const groupIds = groups.map((group) => group.id);
  await db.channel.deleteMany({ where: { OR: [{ id: { startsWith: prefix } }, { groupId: { in: groupIds } }] } });
  await db.teamGroup.deleteMany({ where: { id: { in: groupIds } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("company manager organization boundaries", () => {
  it("creates groups only inside the manager's assigned company", async () => {
    const { manager, ownCompanyId, otherCompanyId, ownGroup } = await fixture();
    const catalogChannelId = `${prefix}catalog-${randomUUID()}`;
    await db.channel.create({ data: { id: catalogChannelId, groupId: ownGroup.id, name: `公共渠道-${randomUUID()}`, normalizedName: catalogChannelId } });
    const denied = await postGroup(new Request("http://localhost/api/company/groups", { method: "POST", body: JSON.stringify({ name: "越权组", departmentId: otherCompanyId }) }));
    expect(denied.status).toBe(400);

    const response = await postGroup(new Request("http://localhost/api/company/groups", { method: "POST", body: JSON.stringify({ name: "新业务组" }) }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ name: "新业务组", departmentId: ownCompanyId });
    const created = await db.teamGroup.findFirstOrThrow({ where: { name: "新业务组", departmentId: ownCompanyId } });
    await expect(db.channel.findUnique({ where: { id_groupId: { id: catalogChannelId, groupId: created.id } } })).resolves.not.toBeNull();
    await expect(db.auditLog.findFirst({ where: { actorId: manager.id, entityId: created.id, action: "GROUP_CREATED" } })).resolves.not.toBeNull();
  });

  it("allows a group to inherit company time or use a different supported country timezone", async () => {
    const { ownCompanyId } = await fixture();
    const inherited = await postGroup(new Request("http://localhost/api/company/groups", { method: "POST", body: JSON.stringify({ name: "德国继承组", timezone: "" }) }));
    expect(inherited.status).toBe(201);
    await expect(inherited.json()).resolves.toMatchObject({ departmentId: ownCompanyId, timezone: null, countryCode: null });

    const us = await postGroup(new Request("http://localhost/api/company/groups", { method: "POST", body: JSON.stringify({ name: "美国东部组", timezone: "America/New_York" }) }));
    expect(us.status).toBe(201);
    await expect(us.json()).resolves.toMatchObject({ departmentId: ownCompanyId, timezone: "America/New_York", countryCode: "US" });

    const invalid = await postGroup(new Request("http://localhost/api/company/groups", { method: "POST", body: JSON.stringify({ name: "错误时区组", timezone: "UTC+8" }) }));
    expect(invalid.status).toBe(400);
  });

  it("creates only LEAD accounts in active groups belonging to the same company", async () => {
    const { ownGroup, otherGroup } = await fixture();
    const foreignUsername = `${prefix}foreign-${randomUUID()}`;
    const foreign = await postLead(new Request("http://localhost/api/company/leads", { method: "POST", body: JSON.stringify({ username: foreignUsername, name: "越权组长", password: "lead-password", groupId: otherGroup.id }) }));
    expect(foreign.status).toBe(400);
    await expect(db.user.findUnique({ where: { username: foreignUsername } })).resolves.toBeNull();

    const elevated = await postLead(new Request("http://localhost/api/company/leads", { method: "POST", body: JSON.stringify({ username: `${prefix}admin-${randomUUID()}`, name: "伪造管理员", password: "lead-password", role: "ADMIN", groupId: ownGroup.id }) }));
    expect(elevated.status).toBe(400);

    const username = `${prefix}lead-${randomUUID()}`;
    const response = await postLead(new Request("http://localhost/api/company/leads", { method: "POST", body: JSON.stringify({ username, name: "本公司组长", password: "lead-password", groupId: ownGroup.id }) }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ username, role: "LEAD", groupId: ownGroup.id, active: true });
    await expect(db.user.findUniqueOrThrow({ where: { username }, select: { mustChangePassword: true } }))
      .resolves.toEqual({ mustChangePassword: true });
  });

  it("cannot edit another company's lead and clears sessions when resetting its own lead", async () => {
    const { manager, ownGroup, otherGroup } = await fixture();
    const ownLead = await db.user.create({ data: { id: `${prefix}own-lead-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "本公司组长", passwordHash: hashPassword("old-password"), role: "LEAD", groupId: ownGroup.id } });
    const otherLead = await db.user.create({ data: { id: `${prefix}other-lead-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "其他公司组长", passwordHash: hashPassword("old-password"), role: "LEAD", groupId: otherGroup.id } });
    await db.session.create({ data: { id: `${prefix}session-${randomUUID()}`, userId: ownLead.id, expiresAt: new Date(Date.now() + 60_000) } });

    const denied = await patchLead(new Request("http://localhost/api/company/leads", { method: "PATCH", body: JSON.stringify({ id: otherLead.id, active: false }) }));
    expect(denied.status).toBe(403);
    await expect(db.user.findUniqueOrThrow({ where: { id: otherLead.id }, select: { active: true } })).resolves.toEqual({ active: true });

    const newPassword = "new-lead-password";
    const response = await patchLead(new Request("http://localhost/api/company/leads", { method: "PATCH", body: JSON.stringify({ id: ownLead.id, password: newPassword }) }));
    expect(response.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: ownLead.id }, select: { passwordHash: true, mustChangePassword: true } });
    expect(verifyPassword(newPassword, updated.passwordHash)).toBe(true);
    expect(updated.mustChangePassword).toBe(true);
    await expect(db.session.count({ where: { userId: ownLead.id } })).resolves.toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: manager.id, entityId: ownLead.id, action: "MEMBER_PASSWORD_RESET" } });
    expect(audit.summary).not.toContain(newPassword);
    expect(audit.summary).not.toContain("passwordHash");
  });

  it("rejects company organization APIs for non-company roles", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new AuthorizationError(undefined, { id: "denied-user", groupId: "denied-team" } as never));
    const groupResponse = await postGroup(new Request("http://localhost/api/company/groups", { method: "POST", body: JSON.stringify({ name: "不应创建" }) }));
    const leadResponse = await patchLead(new Request("http://localhost/api/company/leads", { method: "PATCH", body: JSON.stringify({ id: "missing", active: false }) }));
    expect(groupResponse.status).toBe(403);
    expect(leadResponse.status).toBe(403);
  });

  it("does not let a company manager move a group to another company", async () => {
    const { ownGroup, otherCompanyId } = await fixture();
    const response = await patchGroup(new Request("http://localhost/api/company/groups", { method: "PATCH", body: JSON.stringify({ id: ownGroup.id, name: "改名", departmentId: otherCompanyId }) }));
    expect(response.status).toBe(400);
    await expect(db.teamGroup.findUniqueOrThrow({ where: { id: ownGroup.id }, select: { departmentId: true, name: true } })).resolves.toMatchObject({ name: "本公司一组" });
  });

  it("lets a full company manager create a market-scoped department manager", async () => {
    const { manager, ownCompanyId } = await fixture();
    await db.teamGroup.create({ data: { id: `${prefix}us-group-${randomUUID()}`, name: "美国市场组", departmentId: ownCompanyId, countryCode: "US", timezone: "America/New_York" } });
    const username = `${prefix}department-manager-${randomUUID()}`;
    const response = await postDepartmentManager(new Request("http://localhost/api/company/department-managers", { method: "POST", body: JSON.stringify({ username, name: "美国市场负责人", password: "temporary-password", managementScopeName: "美国市场", managementCountryCode: "US" }) }));
    expect(response.status).toBe(201);
    const created = await db.user.findUniqueOrThrow({ where: { username } });
    expect(created).toMatchObject({ role: "COMPANY_MANAGER", departmentId: ownCompanyId, managementScopeName: "美国市场", managementCountryCode: "US", mustChangePassword: true });

    vi.mocked(auth.requireRole).mockResolvedValue(created);
    const denied = await postDepartmentManager(new Request("http://localhost/api/company/department-managers", { method: "POST", body: JSON.stringify({ username: `${username}-nested`, name: "越权账号", password: "temporary-password", managementScopeName: "德国市场", managementCountryCode: "DE" }) }));
    expect(denied.status).toBe(403);
    vi.mocked(auth.requireRole).mockResolvedValue(manager);
  });
});
