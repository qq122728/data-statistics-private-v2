import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import * as leadMembers from "../../src/lib/lead-members";
import { hashPassword, verifyPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { DELETE, GET, PATCH, POST } from "../../src/app/api/lead/members/route";

const fixturePrefix = "lead-members-test-";

type Fixture = {
  lead: Awaited<ReturnType<typeof db.user.create>>;
  ownGroupId: string;
  otherGroupId: string;
};

async function createFixture(): Promise<Fixture> {
  const ownGroupId = `${fixturePrefix}group-a-${randomUUID()}`;
  const otherGroupId = `${fixturePrefix}group-b-${randomUUID()}`;
  await db.teamGroup.createMany({
    data: [
      { id: ownGroupId, name: "组长验收一组" },
      { id: otherGroupId, name: "组长验收二组" },
    ],
  });
  const lead = await db.user.create({
    data: {
      id: `${fixturePrefix}lead-${randomUUID()}`,
      username: `${fixturePrefix}lead-${randomUUID()}`,
      name: "验收组长",
      passwordHash: hashPassword("demo-password"),
      role: "LEAD",
      groupId: ownGroupId,
    },
  });
  vi.spyOn(auth, "requireRole").mockResolvedValue(lead);
  return { lead, ownGroupId, otherGroupId };
}

async function createUser(input: {
  role: "ADMIN" | "LEAD" | "RECEPTION";
  groupId?: string | null;
  name?: string;
  active?: boolean;
}) {
  return db.user.create({
    data: {
      id: `${fixturePrefix}user-${randomUUID()}`,
      username: `${fixturePrefix}user-${randomUUID()}`,
      name: input.name ?? "验收目标",
      passwordHash: hashPassword("demo-password"),
      role: input.role,
      groupId: input.groupId,
      active: input.active ?? true,
    },
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({
    where: { OR: [{ id: { startsWith: fixturePrefix } }, { username: { startsWith: fixturePrefix } }] },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: fixturePrefix } } });
});

describe.sequential("lead member API", () => {
  it("creates only a same-group member and never serializes password hashes", async () => {
    const { ownGroupId, otherGroupId } = await createFixture();
    const username = `${fixturePrefix}created-${randomUUID()}`;

    const createResponse = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({ username, name: "新组员", password: "member-password" }),
    }));

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { id: string; role: string; groupId: string; passwordHash?: string };
    expect(created).toMatchObject({ username, role: "RECEPTION", groupId: ownGroupId });
    expect(created).not.toHaveProperty("passwordHash");
    await expect(db.user.findUnique({ where: { id: created.id }, select: { role: true, groupId: true, roleAssignments: { select: { role: true } } } }))
      .resolves.toEqual({
        role: "RECEPTION",
        groupId: ownGroupId,
        roleAssignments: expect.arrayContaining([{ role: "RECEPTION" }, { role: "GROUP_OPERATOR" }]),
      });

    const sameGroupMember = await createUser({ role: "RECEPTION", groupId: ownGroupId });
    const crossGroupMember = await createUser({ role: "RECEPTION", groupId: otherGroupId });
    const sameGroupLead = await createUser({ role: "LEAD", groupId: ownGroupId, active: false });
    const administrator = await createUser({ role: "ADMIN" });

    const listResponse = await GET();
    expect(listResponse.status).toBe(200);
    const members = await listResponse.json() as Array<{ id: string; role: string; groupId: string; passwordHash?: string }>;
    expect(new Set(members.map((member) => member.id))).toEqual(new Set([created.id, sameGroupMember.id]));
    expect(members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, role: "RECEPTION", groupId: ownGroupId }),
      expect.objectContaining({ id: sameGroupMember.id, role: "RECEPTION", groupId: ownGroupId }),
    ]));
    for (const excludedId of [crossGroupMember.id, sameGroupLead.id, administrator.id]) {
      expect(members.map((member) => member.id)).not.toContain(excludedId);
    }
    for (const member of members) expect(member).not.toHaveProperty("passwordHash");
  });

  it("lets a lead correct a same-group member name and login username with audit history", async () => {
    await createFixture();
    const originalUsername = `${fixturePrefix}reversed-${randomUUID()}`;
    const createResponse = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({ username: originalUsername, name: "错误姓名", password: "member-password" }),
    }));
    expect(createResponse.status).toBe(201);
    const member = await createResponse.json() as { id: string };
    const correctedUsername = `${fixturePrefix}corrected-${randomUUID()}`;

    const response = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: member.id, name: "正确姓名", username: correctedUsername }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: member.id, name: "正确姓名", username: correctedUsername });
    await expect(db.user.findUniqueOrThrow({ where: { id: member.id }, select: { name: true, username: true, employeeCode: true } }))
      .resolves.toEqual({ name: "正确姓名", username: correctedUsername, employeeCode: correctedUsername });
    await expect(db.auditLog.findFirst({ where: { entityType: "User", entityId: member.id, action: "MEMBER_UPDATED" }, orderBy: { createdAt: "desc" } }))
      .resolves.toMatchObject({ summary: expect.stringContaining("username") });
  });

  it("lets a lead permanently delete a mistaken empty same-group account", async () => {
    const { ownGroupId } = await createFixture();
    const member = await createUser({ role: "RECEPTION", groupId: ownGroupId, name: "误开空账号" });
    await db.session.create({ data: { userId: member.id, expiresAt: new Date(Date.now() + 60_000) } });

    const response = await DELETE(new Request("http://localhost/api/lead/members", {
      method: "DELETE",
      body: JSON.stringify({ id: member.id }),
    }));

    expect(response.status).toBe(200);
    await expect(db.user.findUnique({ where: { id: member.id } })).resolves.toBeNull();
    await expect(db.auditLog.findFirst({ where: { action: "ACCOUNT_DELETED", entityType: "User", entityId: member.id } }))
      .resolves.toMatchObject({ actorId: expect.stringContaining(`${fixturePrefix}lead-`) });
  });

  it("refuses to hard-delete an account that already owns operation history", async () => {
    const { ownGroupId } = await createFixture();
    const member = await createUser({ role: "RECEPTION", groupId: ownGroupId, name: "已有历史账号" });
    await db.auditLog.create({ data: { actorId: member.id, action: "TEST_ACTIVITY", entityType: "User", entityId: member.id, summary: "{}" } });

    const response = await DELETE(new Request("http://localhost/api/lead/members", {
      method: "DELETE",
      body: JSON.stringify({ id: member.id }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "该账号已经产生业务或操作记录，不能永久删除；请改为停用账号" });
    await expect(db.user.findUnique({ where: { id: member.id } })).resolves.not.toBeNull();
  });

  it("creates frontline roles but routes every existing-member role change through personnel transfer", async () => {
    const { ownGroupId } = await createFixture();
    const member = await createUser({ role: "RECEPTION", groupId: ownGroupId });

    const createOperator = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({ username: `${fixturePrefix}${randomUUID()}`, name: "新炒群", password: "member-password", role: "GROUP_OPERATOR" }),
    }));
    expect(createOperator.status).toBe(201);
    await expect(createOperator.json()).resolves.toMatchObject({
      role: "GROUP_OPERATOR",
      groupId: ownGroupId,
    });

    const createWithElevatedRole = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({ username: `${fixturePrefix}${randomUUID()}`, name: "越权创建", password: "member-password", role: "ADMIN" }),
    }));
    const createWithGroup = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({ username: `${fixturePrefix}${randomUUID()}`, name: "越权创建", password: "member-password", groupId: "another-group" }),
    }));
    const updateWithFrontlineRole = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: member.id, role: "EXPERT" }),
    }));
    expect(updateWithFrontlineRole.status).toBe(400);
    await expect(updateWithFrontlineRole.json()).resolves.toEqual({
      error: "岗位变化必须使用“人员调岗与跨组调动”，不能直接覆盖岗位历史",
    });

    const updateWithElevatedRole = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: member.id, role: "LEAD" }),
    }));
    const updateWithGroup = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: member.id, groupId: "another-group" }),
    }));

    expect(createWithElevatedRole.status).toBe(400);
    await expect(createWithElevatedRole.json()).resolves.toEqual({ error: "请完整填写成员信息" });
    expect(updateWithElevatedRole.status).toBe(400);
    await expect(updateWithElevatedRole.json()).resolves.toEqual({ error: "岗位不正确" });
    for (const response of [createWithGroup, updateWithGroup]) {
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "不允许修改所属小组" });
    }
  });

  it("lets a lead add expert permission to an old account without allowing existing roles to be removed", async () => {
    const { ownGroupId } = await createFixture();
    const member = await createUser({ role: "RECEPTION", groupId: ownGroupId });

    const addExpertResponse = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: member.id, secondaryRoles: ["EXPERT"] }),
    }));

    expect(addExpertResponse.status).toBe(200);
    await expect(addExpertResponse.json()).resolves.toMatchObject({
      id: member.id,
      role: "RECEPTION",
      roleAssignments: expect.arrayContaining([
        expect.objectContaining({ role: "RECEPTION" }),
        expect.objectContaining({ role: "EXPERT" }),
      ]),
    });

    const removeExpertResponse = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: member.id, secondaryRoles: [] }),
    }));

    expect(removeExpertResponse.status).toBe(400);
    await expect(removeExpertResponse.json()).resolves.toEqual({
      error: "已有岗位不能在这里关闭；请使用“人员调岗与跨组调动”",
    });
    await expect(db.userRoleAssignment.findMany({ where: { userId: member.id }, select: { role: true } }))
      .resolves.toEqual(expect.arrayContaining([{ role: "RECEPTION" }, { role: "EXPERT" }]));
  });

  it("creates and updates a receptionist pairing in the same member transaction", async () => {
    const { ownGroupId } = await createFixture();
    const operatorResponse = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({
        username: `${fixturePrefix}operator-${randomUUID()}`,
        name: "配对炒群",
        password: "member-password",
        role: "GROUP_OPERATOR",
      }),
    }));
    const operator = await operatorResponse.json() as { id: string };

    const receptionistResponse = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({
        username: `${fixturePrefix}reception-${randomUUID()}`,
        name: "配对接粉",
        password: "member-password",
        role: "RECEPTION",
        pairedGroupOperatorId: operator.id,
      }),
    }));
    expect(receptionistResponse.status).toBe(201);
    const receptionist = await receptionistResponse.json() as { id: string };
    await expect(db.groupOperatorReception.findUnique({
      where: { groupOperatorId_receptionistId: { groupOperatorId: operator.id, receptionistId: receptionist.id } },
    })).resolves.toBeTruthy();

    const pendingResponse = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: receptionist.id, pairedGroupOperatorId: null }),
    }));
    expect(pendingResponse.status).toBe(200);
    await expect(db.groupOperatorReception.findFirst({ where: { receptionistId: receptionist.id } })).resolves.toBeNull();
    await expect(db.groupOperatorReceptionHistory.findFirst({
      where: { receptionistId: receptionist.id, groupOperatorId: operator.id },
      orderBy: { effectiveFrom: "desc" },
    })).resolves.toMatchObject({ effectiveTo: expect.any(Date) });

    const outsideGroupId = `${fixturePrefix}outside-group-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: outsideGroupId, name: "外组" } });
    const outsider = await db.user.create({
      data: {
        id: `${fixturePrefix}outside-operator-${randomUUID()}`,
        username: `${fixturePrefix}outside-operator-${randomUUID()}`,
        name: "外组炒群",
        passwordHash: hashPassword("demo-password"),
        role: "GROUP_OPERATOR",
        groupId: outsideGroupId,
      },
    });
    const rejected = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: receptionist.id, role: "EXPERT", pairedGroupOperatorId: outsider.id }),
    }));
    expect(rejected.status).toBe(400);
    await expect(db.user.findUniqueOrThrow({ where: { id: receptionist.id }, select: { role: true } })).resolves.toEqual({ role: "RECEPTION" });
    await expect(db.groupOperatorReception.findFirst({ where: { receptionistId: receptionist.id } })).resolves.toBeNull();
    await expect(db.user.findUniqueOrThrow({ where: { id: operator.id }, select: { groupId: true } })).resolves.toEqual({ groupId: ownGroupId });

    const dualUsername = `${fixturePrefix}dual-${randomUUID()}`;
    const dualResponse = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({
        username: dualUsername,
        name: "接粉炒群兼任",
        password: "member-password",
        role: "RECEPTION",
        secondaryRoles: ["GROUP_OPERATOR"],
        pairedGroupOperatorId: null,
      }),
    }));
    expect(dualResponse.status).toBe(201);
    const dual = await dualResponse.json() as { id: string };
    await expect(db.groupOperatorReception.findUnique({
      where: { groupOperatorId_receptionistId: { groupOperatorId: dual.id, receptionistId: dual.id } },
    })).resolves.toBeTruthy();

    const rejectedUsername = `${fixturePrefix}invalid-pair-${randomUUID()}`;
    const rejectedCreate = await POST(new Request("http://localhost/api/lead/members", {
      method: "POST",
      body: JSON.stringify({
        username: rejectedUsername,
        name: "不应落库",
        password: "member-password",
        role: "RECEPTION",
        pairedGroupOperatorId: outsider.id,
      }),
    }));
    expect(rejectedCreate.status).toBe(400);
    await expect(db.user.findUnique({ where: { username: rejectedUsername } })).resolves.toBeNull();
  });

  it("rechecks the lead's current group before returning the member list", async () => {
    const { lead, ownGroupId, otherGroupId } = await createFixture();
    const formerGroupMember = await createUser({ role: "RECEPTION", groupId: ownGroupId });
    const currentGroupMember = await createUser({ role: "RECEPTION", groupId: otherGroupId });

    const realRequireLeadRequest = leadMembers.requireLeadRequest;
    vi.spyOn(leadMembers, "requireLeadRequest").mockImplementationOnce(async () => {
      const access = await realRequireLeadRequest();
      // Move the lead after the request has read the old group, but before the
      // list transaction starts. The route must recheck and use the new group.
      await db.user.update({ where: { id: lead.id }, data: { groupId: otherGroupId } });
      return access;
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const members = await response.json() as Array<{ id: string; groupId: string }>;
    expect(members.map(({ id }) => id)).toContain(currentGroupMember.id);
    expect(members.map(({ id }) => id)).not.toContain(formerGroupMember.id);
    expect(members.every(({ groupId }) => groupId === otherGroupId)).toBe(true);
  });

  it("returns the same generic denial for every target outside the lead's member scope", async () => {
    const { lead, ownGroupId, otherGroupId } = await createFixture();
    const crossGroupMember = await createUser({ role: "RECEPTION", groupId: otherGroupId });
    const otherLead = await createUser({ role: "LEAD", groupId: ownGroupId, active: false });
    const administrator = await createUser({ role: "ADMIN" });
    const targets = [crossGroupMember.id, otherLead.id, administrator.id, lead.id, `${fixturePrefix}missing-${randomUUID()}`];

    for (const id of targets) {
      const response = await PATCH(new Request("http://localhost/api/lead/members", {
        method: "PATCH",
        body: JSON.stringify({ id, active: false }),
      }));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "无权管理该组员" });
    }
  });

  it("revokes prior sessions on password reset and keeps both response and audit free of the secret", async () => {
    const { lead, ownGroupId } = await createFixture();
    const member = await createUser({ role: "RECEPTION", groupId: ownGroupId });
    const nextPassword = "new-member-password";
    await db.session.create({
      data: { id: `${fixturePrefix}session-${randomUUID()}`, userId: member.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    const response = await PATCH(new Request("http://localhost/api/lead/members", {
      method: "PATCH",
      body: JSON.stringify({ id: member.id, password: nextPassword }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("passwordHash");
    const updated = await db.user.findUniqueOrThrow({ where: { id: member.id }, select: { passwordHash: true, mustChangePassword: true } });
    expect(verifyPassword(nextPassword, updated.passwordHash)).toBe(true);
    expect(updated.mustChangePassword).toBe(true);
    await expect(db.session.count({ where: { userId: member.id } })).resolves.toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { actorId: lead.id, entityId: member.id, action: "MEMBER_PASSWORD_RESET" } });
    expect(audit.summary).not.toContain(nextPassword);
    expect(audit.summary).not.toContain(updated.passwordHash);
  });
});
