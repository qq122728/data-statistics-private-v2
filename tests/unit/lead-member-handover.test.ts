import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { POST } from "../../src/app/api/lead/members/handover/route";
import { db } from "../../src/lib/db";

const prefix = "lead-member-handover-";

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] } });
  await db.deviceAccount.deleteMany({ where: { ownerId: { in: userIds } } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.device.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("组长本组工作交接", () => {
  it("只把当前责任客户和设备转给本组在职组员，不再依赖旧岗位标签，并保留审计", async () => {
    const suffix = randomUUID();
    const groupId = `${prefix}group-${suffix}`;
    const otherGroupId = `${prefix}other-${suffix}`;
    const leadId = `${prefix}lead-${suffix}`;
    const sourceId = `${prefix}source-${suffix}`;
    const targetId = `${prefix}target-${suffix}`;
    const outsiderId = `${prefix}outsider-${suffix}`;
    await db.teamGroup.createMany({ data: [{ id: groupId, name: `交接组-${suffix}` }, { id: otherGroupId, name: `外组-${suffix}` }] });
    const lead = await db.user.create({ data: { id: leadId, username: leadId, name: "交接组长", role: "LEAD", groupId } });
    await db.user.create({ data: { id: sourceId, username: sourceId, name: "原负责人", role: "RECEPTION", groupId, roleAssignments: { create: [{ role: "RECEPTION" }, { role: "GROUP_OPERATOR" }, { role: "EXPERT" }] } } });
    await db.user.create({ data: { id: targetId, username: targetId, name: "新负责人", role: "EXPERT", groupId } });
    await db.user.create({ data: { id: outsiderId, username: outsiderId, name: "外组成员", role: "RECEPTION", groupId: otherGroupId } });
    vi.spyOn(auth, "requireRole").mockResolvedValue(lead);
    const channel = await db.channel.create({ data: { id: `${prefix}channel-${suffix}`, groupId, name: "交接渠道", normalizedName: `${prefix}${suffix}` } });
    const batch = await db.sourceBatch.create({ data: { groupId, channelId: channel.id, sourceDate: "2026-08-31" } });
    const reception = await db.leadCustomer.create({ data: { phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: batch.id, ownerId: sourceId, attributionOwnerId: sourceId } });
    const operator = await db.leadCustomer.create({ data: { phone: `2${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: batch.id, ownerId: sourceId, attributionOwnerId: sourceId, joinedOn: "2026-08-31", groupStatus: "JOINED", groupOperatorOwnerId: sourceId } });
    const expert = await db.leadCustomer.create({ data: { phone: `3${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: batch.id, ownerId: sourceId, attributionOwnerId: sourceId, joinedOn: "2026-08-31", groupStatus: "JOINED", groupOperatorOwnerId: sourceId, expertIntroducedOn: "2026-08-31", expertOwnerId: sourceId, expertWorkflowStage: "TRACKING" } });
    const device = await db.device.create({ data: { groupId, code: `D-${suffix}`, memberId: sourceId } });
    const inactiveDevice = await db.device.create({ data: { groupId, code: `D-OLD-${suffix}`, memberId: sourceId, active: false } });
    const account = await db.deviceAccount.create({ data: { groupId, ownerId: sourceId, accountType: "NORMAL_WS", provider: "WS", accountNumber: `A-${suffix}` } });

    const denied = await POST(new Request("http://localhost/api/lead/members/handover", { method: "POST", body: JSON.stringify({ sourceId, targetId: outsiderId, reason: "交接给外组成员" }) }));
    expect(denied.status).toBe(403);
    const response = await POST(new Request("http://localhost/api/lead/members/handover", { method: "POST", body: JSON.stringify({ sourceId, targetId, reason: "本组工作调整交接" }) }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ transferred: { reception: 1, operator: 1, expert: 1, physicalDevices: 1, deviceAccounts: 1 } });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: reception.id }, select: { ownerId: true, attributionOwnerId: true } })).resolves.toEqual({ ownerId: targetId, attributionOwnerId: sourceId });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: operator.id }, select: { groupOperatorOwnerId: true } })).resolves.toEqual({ groupOperatorOwnerId: targetId });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: expert.id }, select: { expertOwnerId: true, batchId: true } })).resolves.toEqual({ expertOwnerId: targetId, batchId: batch.id });
    await expect(db.device.findUniqueOrThrow({ where: { id: device.id }, select: { memberId: true, groupId: true } })).resolves.toEqual({ memberId: targetId, groupId });
    await expect(db.device.findUniqueOrThrow({ where: { id: inactiveDevice.id }, select: { memberId: true, groupId: true, active: true } })).resolves.toEqual({ memberId: sourceId, groupId, active: false });
    await expect(db.deviceAccount.findUniqueOrThrow({ where: { id: account.id }, select: { ownerId: true, groupId: true } })).resolves.toEqual({ ownerId: targetId, groupId });
    await expect(db.auditLog.findFirst({ where: { actorId: leadId, entityId: sourceId, action: "MEMBER_WORK_HANDOVER" } })).resolves.toBeTruthy();
  });
});
