import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { POST } from "../../src/app/api/notifications/route";
import { db } from "../../src/lib/db";
import { notificationScope } from "../../src/lib/notifications";

const prefix = "notification-scope-";

async function fixture() {
  const suffix = randomUUID();
  const companyA = `${prefix}company-a-${suffix}`;
  const companyB = `${prefix}company-b-${suffix}`;
  const departmentA1 = `${prefix}department-a1-${suffix}`;
  const departmentA2 = `${prefix}department-a2-${suffix}`;
  const departmentB = `${prefix}department-b-${suffix}`;
  const groupA1 = `${prefix}group-a1-${suffix}`;
  const groupA2 = `${prefix}group-a2-${suffix}`;
  const groupB = `${prefix}group-b-${suffix}`;
  await db.company.createMany({ data: [{ id: companyA, name: `通知A公司-${suffix}` }, { id: companyB, name: `通知B公司-${suffix}` }] });
  await db.department.createMany({ data: [
    { id: departmentA1, name: `通知A1部-${suffix}`, companyId: companyA },
    { id: departmentA2, name: `通知A2部-${suffix}`, companyId: companyA },
    { id: departmentB, name: `通知B部-${suffix}`, companyId: companyB },
  ] });
  await db.teamGroup.createMany({ data: [
    { id: groupA1, name: `通知A1组-${suffix}`, departmentId: departmentA1 },
    { id: groupA2, name: `通知A2组-${suffix}`, departmentId: departmentA2 },
    { id: groupB, name: `通知B组-${suffix}`, departmentId: departmentB },
  ] });
  const ids = {
    hq: `${prefix}hq-${suffix}`,
    companyManager: `${prefix}company-manager-${suffix}`,
    departmentManager: `${prefix}department-manager-${suffix}`,
    lead: `${prefix}lead-${suffix}`,
    expertA1: `${prefix}expert-a1-${suffix}`,
    expertA2: `${prefix}expert-a2-${suffix}`,
    expertB: `${prefix}expert-b-${suffix}`,
    multiRoleA1: `${prefix}multi-role-a1-${suffix}`,
  };
  await db.user.createMany({ data: [
    { id: ids.hq, username: ids.hq, name: "总公司通知管理员", role: "COMPANY_MANAGER", duty: "HQ_MANAGER" },
    { id: ids.companyManager, username: ids.companyManager, name: "A公司通知管理员", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: companyA },
    { id: ids.departmentManager, username: ids.departmentManager, name: "A1部通知管理员", role: "COMPANY_MANAGER", duty: "DEPARTMENT_MANAGER", departmentId: departmentA1 },
    { id: ids.lead, username: ids.lead, name: "A1组长", role: "LEAD", duty: "LEAD", groupId: groupA1 },
    { id: ids.expertA1, username: ids.expertA1, name: "A1专家", role: "EXPERT", groupId: groupA1 },
    { id: ids.expertA2, username: ids.expertA2, name: "A2专家", role: "EXPERT", groupId: groupA2 },
    { id: ids.expertB, username: ids.expertB, name: "B专家", role: "EXPERT", groupId: groupB },
    { id: ids.multiRoleA1, username: ids.multiRoleA1, name: "A1兼任专家", role: "RECEPTION", groupId: groupA1 },
  ] });
  await db.userRoleAssignment.createMany({ data: [
    { userId: ids.multiRoleA1, role: "RECEPTION" },
    { userId: ids.multiRoleA1, role: "EXPERT" },
  ] });
  await db.userManagedDepartment.create({ data: { userId: ids.departmentManager, departmentId: departmentA1 } });
  const actor = (id: string) => db.user.findUniqueOrThrow({ where: { id }, include: { roleAssignments: { select: { role: true } }, resourceChannelAccess: { select: { channelId: true } }, managedDepartments: { select: { departmentId: true } } } });
  return { companyA, companyB, departmentA1, departmentA2, departmentB, groupA1, groupA2, groupB, ids, actor };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "权限通知", content: "这是一条用于验证组织范围的通知", type: "GENERAL", requiresAck: false, ...body }) });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await db.notification.deleteMany({ where: { senderId: { startsWith: prefix } } });
  await db.auditLog.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await db.userManagedDepartment.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.userRoleAssignment.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.company.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("通知三级组织发送范围", () => {
  it("HQ可见全局，公司、部门和组长只获得对应人员", async () => {
    const data = await fixture();
    const hq = await data.actor(data.ids.hq);
    const company = await data.actor(data.ids.companyManager);
    const department = await data.actor(data.ids.departmentManager);
    const lead = await data.actor(data.ids.lead);
    expect((await notificationScope(hq)).users.map((user) => user.id)).toEqual(expect.arrayContaining([data.ids.expertA1, data.ids.expertA2, data.ids.expertB]));
    expect((await notificationScope(company)).users.map((user) => user.id)).toEqual(expect.arrayContaining([data.ids.expertA1, data.ids.expertA2]));
    expect((await notificationScope(company)).users.map((user) => user.id)).not.toContain(data.ids.expertB);
    expect((await notificationScope(department)).users.map((user) => user.id)).toContain(data.ids.expertA1);
    expect((await notificationScope(department)).users.map((user) => user.id)).not.toContain(data.ids.expertA2);
    expect((await notificationScope(lead)).users.map((user) => user.id)).toEqual(expect.arrayContaining([data.ids.lead, data.ids.expertA1]));
    expect((await notificationScope(lead)).users.map((user) => user.id)).not.toContain(data.ids.departmentManager);
  });

  it("公司管理员手改 departmentId 或混入公司外 userIds 都拒绝整次发送", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(await data.actor(data.ids.companyManager));
    expect((await POST(request({ targetType: "ALL", departmentId: data.departmentB }))).status).toBe(403);
    expect((await POST(request({ targetType: "USERS", userIds: [data.ids.expertA1, data.ids.expertB] }))).status).toBe(403);
    await expect(db.notification.count({ where: { senderId: data.ids.companyManager } })).resolves.toBe(0);
  });

  it("部门管理员和组长手改 groupId/userIds 不能越权", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(await data.actor(data.ids.departmentManager));
    expect((await POST(request({ targetType: "GROUP", groupId: data.groupB }))).status).toBe(403);
    vi.restoreAllMocks();
    vi.spyOn(auth, "requireUser").mockResolvedValue(await data.actor(data.ids.lead));
    expect((await POST(request({ targetType: "USERS", userIds: [data.ids.expertA1, data.ids.expertA2] }))).status).toBe(403);
  });

  it("普通组员和专家只读，不能发布通知", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(await data.actor(data.ids.expertA1));
    expect((await POST(request({ targetType: "ALL" }))).status).toBe(403);
  });

  it("按岗位发送时同时命中主岗位和兼任岗位", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(await data.actor(data.ids.lead));
    const response = await POST(request({ targetType: "ROLE", role: "EXPERT" }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ recipientCount: 2 });
    await expect(db.notificationRecipient.findFirst({ where: { userId: data.ids.multiRoleA1 }, select: { id: true } })).resolves.not.toBeNull();
  });
});
