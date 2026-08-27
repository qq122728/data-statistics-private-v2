import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { loadRoleRankings } from "../../src/lib/analytics/role-rankings";
import { PATCH } from "../../src/app/api/admin/users/route";
import { POST as TRANSFER } from "../../src/app/api/admin/users/transfer/route";

const prefix = "personnel-transfer-";

async function fixture() {
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } });
  vi.spyOn(auth, "requireRole").mockResolvedValue(admin);
  const groupA = `${prefix}a-${randomUUID()}`;
  const groupB = `${prefix}b-${randomUUID()}`;
  const userId = `${prefix}user-${randomUUID()}`;
  const channelId = `${prefix}channel-${randomUUID()}`;
  await db.teamGroup.createMany({ data: [{ id: groupA, name: `调动A组-${randomUUID()}` }, { id: groupB, name: `调动B组-${randomUUID()}` }] });
  await db.user.create({
    data: {
      id: userId,
      employeeCode: `AA-${randomUUID().slice(0, 8)}`,
      username: `${prefix}${randomUUID()}`,
      name: "跨组成员AA",
      role: "RECEPTION",
      groupId: groupA,
      membershipHistory: { create: { groupId: groupA, role: "RECEPTION", effectiveFrom: "2026-08-01", reason: "入职A组" } },
    },
  });
  await db.channel.create({ data: { id: channelId, groupId: groupA, name: "调动测试渠道", normalizedName: `${prefix}${randomUUID()}` } });
  const batch = await db.sourceBatch.create({ data: { groupId: groupA, channelId, sourceDate: "2026-08-10" } });
  const lead = await db.leadCustomer.create({
    data: {
      phone: `9${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
      batchId: batch.id,
      ownerId: userId,
      attributionOwnerId: userId,
      repliedOn: "2026-08-11",
      replyStatus: "REPLIED",
      joinedOn: "2026-08-12",
      groupStatus: "JOINED",
    },
  });
  await db.session.create({ data: { id: `${prefix}session-${randomUUID()}`, userId, expiresAt: new Date(Date.now() + 60_000) } });
  return { groupA, groupB, userId, batchId: batch.id, leadId: lead.id };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: userIds } }, { actorId: { in: userIds } }] } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("人员调组历史", () => {
  it("保留原组客户和业绩，只更新当前权限，并使旧会话失效", async () => {
    const data = await fixture();
    const before = await db.user.findUniqueOrThrow({ where: { id: data.userId }, select: { employeeCode: true } });
    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "下半月调至B组担任专家" }),
    }));
    expect(response.status).toBe(200);

    const member = await db.user.findUniqueOrThrow({ where: { id: data.userId }, include: { membershipHistory: { orderBy: { effectiveFrom: "asc" } } } });
    expect(member).toMatchObject({ employeeCode: before.employeeCode, groupId: data.groupB, role: "EXPERT" });
    expect(member.membershipHistory).toMatchObject([
      { groupId: data.groupA, role: "RECEPTION", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-15" },
      { groupId: data.groupB, role: "EXPERT", effectiveFrom: "2026-08-16", effectiveTo: null },
    ]);
    await expect(db.session.count({ where: { userId: data.userId } })).resolves.toBe(0);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: data.leadId }, select: { ownerId: true, attributionOwnerId: true, batch: { select: { groupId: true } } } })).resolves.toEqual({ ownerId: data.userId, attributionOwnerId: data.userId, batch: { groupId: data.groupA } });

    const aRanking = await loadRoleRankings({ groupIds: [data.groupA], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-31", today: "2026-08-31" });
    expect(aRanking.reception.find((row) => row.id === data.userId)).toMatchObject({ groupId: data.groupA, valid: 1, replied: 1, joined: 1 });
    const bRanking = await loadRoleRankings({ groupIds: [data.groupB], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-31", today: "2026-08-31" });
    expect(bRanking.reception.some((row) => row.id === data.userId)).toBe(false);
    const companyRanking = await loadRoleRankings({ groupIds: [data.groupA, data.groupB], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-31", today: "2026-08-31" });
    expect(companyRanking.reception.filter((row) => row.id === data.userId)).toHaveLength(1);
    expect(companyRanking.groups.find((row) => row.id === data.groupA)).toMatchObject({ valid: 1, joined: 1 });
    expect(companyRanking.groups.find((row) => row.id === data.groupB)).toMatchObject({ valid: 0, joined: 0 });
  });

  it("把原组尚未进群的客户交给原组成员，但保留客户原归属", async () => {
    const data = await fixture();
    const handoffId = `${prefix}handoff-${randomUUID()}`;
    await db.user.create({ data: { id: handoffId, employeeCode: `AB-${randomUUID().slice(0, 8)}`, username: `${prefix}${randomUUID()}`, name: "A组接收人", role: "RECEPTION", groupId: data.groupA } });
    const pending = await db.leadCustomer.create({ data: { phone: `8${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: data.batchId, ownerId: data.userId, attributionOwnerId: data.userId } });

    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", effectiveOn: "2026-08-16", reason: "调入B组负责专家", receptionHandoffId: handoffId }),
    }));
    expect(response.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: pending.id }, select: { ownerId: true, attributionOwnerId: true, batch: { select: { groupId: true } } } })).resolves.toEqual({ ownerId: handoffId, attributionOwnerId: data.userId, batch: { groupId: data.groupA } });
  });

  it("拒绝通过普通编辑直接覆盖小组", async () => {
    const data = await fixture();
    const response = await PATCH(new Request("http://localhost/api/admin/users", { method: "PATCH", body: JSON.stringify({ id: data.userId, groupId: data.groupB }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "小组调整必须使用“办理调动”，不能直接覆盖历史小组" });
    await expect(db.user.findUniqueOrThrow({ where: { id: data.userId }, select: { groupId: true } })).resolves.toEqual({ groupId: data.groupA });
  });

  it("兼任岗位变化也新建履历，不覆盖原岗位记录", async () => {
    const data = await fixture();
    const pending = await db.leadCustomer.create({ data: { phone: `7${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: data.batchId, ownerId: data.userId, attributionOwnerId: data.userId } });
    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupA, role: "RECEPTION", secondaryRoles: ["GROUP_OPERATOR"], effectiveOn: "2026-08-16", reason: "开始兼任原组炒群工作" }),
    }));
    expect(response.status).toBe(200);
    const member = await db.user.findUniqueOrThrow({ where: { id: data.userId }, include: { membershipHistory: { orderBy: { effectiveFrom: "asc" } }, roleAssignments: true } });
    expect(member.membershipHistory).toMatchObject([
      { groupId: data.groupA, role: "RECEPTION", secondaryRoles: null, effectiveTo: "2026-08-15" },
      { groupId: data.groupA, role: "RECEPTION", secondaryRoles: "GROUP_OPERATOR", effectiveTo: null },
    ]);
    expect(member.roleAssignments.map((assignment) => assignment.role).sort()).toEqual(["GROUP_OPERATOR", "RECEPTION"]);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: pending.id }, select: { ownerId: true } })).resolves.toEqual({ ownerId: data.userId });
  });

  it("允许公司管理员办理本公司内部调动", async () => {
    const data = await fixture();
    const manager = await db.user.create({ data: { id: `${prefix}company-manager-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "公司管理员", role: "COMPANY_MANAGER", departmentId: "default-department" } });
    vi.mocked(auth.requireRole).mockResolvedValue(manager);

    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "公司内部调至B组担任专家" }),
    }));

    expect(response.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({ where: { id: data.userId }, select: { groupId: true, role: true } })).resolves.toEqual({ groupId: data.groupB, role: "EXPERT" });
  });

  it("拒绝公司管理员跨公司调动人员", async () => {
    const data = await fixture();
    const manager = await db.user.create({ data: { id: `${prefix}company-manager-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "公司管理员", role: "COMPANY_MANAGER", departmentId: "default-department" } });
    const otherDepartmentId = `${prefix}other-company-${randomUUID()}`;
    const otherGroupId = `${prefix}other-group-${randomUUID()}`;
    await db.department.create({ data: { id: otherDepartmentId, name: `其他公司-${randomUUID()}` } });
    await db.teamGroup.create({ data: { id: otherGroupId, name: `其他公司小组-${randomUUID()}`, departmentId: otherDepartmentId } });
    vi.mocked(auth.requireRole).mockResolvedValue(manager);

    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: otherGroupId, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "尝试跨公司调动成员" }),
    }));

    expect(response.status).toBe(403);
    await expect(db.user.findUniqueOrThrow({ where: { id: data.userId }, select: { groupId: true } })).resolves.toEqual({ groupId: data.groupA });
  });

  it("部门管理员可在本市场升级组长，但不能把员工调到其他市场", async () => {
    const data = await fixture();
    await db.teamGroup.update({ where: { id: data.groupA }, data: { countryCode: "US", timezone: "America/New_York" } });
    await db.teamGroup.update({ where: { id: data.groupB }, data: { countryCode: "DE", timezone: "Europe/Berlin" } });
    const manager = await db.user.create({ data: { id: `${prefix}department-manager-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "美国市场管理员", role: "COMPANY_MANAGER", departmentId: "default-department", managementScopeName: "美国市场", managementCountryCode: "US" } });
    vi.mocked(auth.requireRole).mockResolvedValue(manager);

    const denied = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "尝试调到德国市场" }),
    }));
    expect(denied.status).toBe(403);

    const promoted = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupA, role: "LEAD", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "原组长调走后升级为新组长" }),
    }));
    expect(promoted.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({ where: { id: data.userId }, select: { groupId: true, role: true } })).resolves.toEqual({ groupId: data.groupA, role: "LEAD" });
  });
});
