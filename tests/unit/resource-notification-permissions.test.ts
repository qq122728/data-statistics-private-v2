import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as auth from "../../src/lib/auth";
import { POST } from "../../src/app/api/notifications/route";
import { db } from "../../src/lib/db";

const prefix = "resource-notification-test-";

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await db.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await db.notification.deleteMany({ where: { senderId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

async function fixture() {
  const suffix = randomUUID();
  const departmentId = `${prefix}department-${suffix}`;
  const adsGroupA = `${prefix}ads-a-${suffix}`;
  const adsGroupB = `${prefix}ads-b-${suffix}`;
  const smsGroup = `${prefix}sms-${suffix}`;
  await db.department.create({ data: { id: departmentId, name: `资源通知部门-${suffix}` } });
  await db.teamGroup.createMany({ data: [
    { id: adsGroupA, name: `投流一组-${suffix}`, departmentId },
    { id: adsGroupB, name: `投流二组-${suffix}`, departmentId },
    { id: smsGroup, name: `短信组-${suffix}`, departmentId },
  ] });
  const resourceId = `${prefix}resource-${suffix}`;
  const adsUserA = `${prefix}ads-user-a-${suffix}`;
  const adsUserB = `${prefix}ads-user-b-${suffix}`;
  const smsUser = `${prefix}sms-user-${suffix}`;
  await db.user.createMany({ data: [
    { id: resourceId, username: resourceId, name: "投流资源", passwordHash: "test", role: "RESOURCE_MANAGER" },
    { id: adsUserA, username: adsUserA, name: "投流一组成员", passwordHash: "test", role: "RECEPTION", groupId: adsGroupA },
    { id: adsUserB, username: adsUserB, name: "投流二组成员", passwordHash: "test", role: "GROUP_OPERATOR", groupId: adsGroupB },
    { id: smsUser, username: smsUser, name: "短信组成员", passwordHash: "test", role: "RECEPTION", groupId: smsGroup },
  ] });
  const adsChannelA = `${prefix}ads-channel-a-${suffix}`;
  await Promise.all([
    db.channel.create({ data: { id: adsChannelA, name: "投流 A", normalizedName: adsChannelA, groupId: adsGroupA, channelType: "ADS" } }),
    db.channel.create({ data: { id: `${prefix}ads-channel-b-${suffix}`, name: "投流 B", normalizedName: `${prefix}ads-channel-b-${suffix}`, groupId: adsGroupB, channelType: "ADS" } }),
    db.channel.create({ data: { id: `${prefix}sms-channel-${suffix}`, name: "短信", normalizedName: `${prefix}sms-channel-${suffix}`, groupId: smsGroup, channelType: "SMS" } }),
  ]);
  await db.resourceChannelAccess.create({ data: { userId: resourceId, channelId: adsChannelA } });
  const resource = await db.user.findUniqueOrThrow({ where: { id: resourceId }, include: { resourceChannelAccess: { select: { channelId: true } } } });
  return { resource, adsGroupB, smsGroup, adsUserB, smsUser };
}

function request(body: object) {
  return new Request("http://localhost/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "渠道提醒", content: "请及时核对渠道数据", type: "GENERAL", requiresAck: false, ...body }) });
}

describe.sequential("resource notification permissions", () => {
  it("does not expand an explicitly assigned channel to another channel of the same type", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(data.resource);
    const response = await POST(request({ targetType: "GROUP", groupId: data.adsGroupB }));
    expect(response.status).toBe(403);
    await expect(db.notificationRecipient.findFirst({ where: { userId: data.adsUserB }, select: { id: true } })).resolves.toBeNull();
  });

  it("rejects a hand-edited SMS group or user for an ADS resource account", async () => {
    const data = await fixture();
    vi.spyOn(auth, "requireUser").mockResolvedValue(data.resource);
    const groupResponse = await POST(request({ targetType: "GROUP", groupId: data.smsGroup }));
    expect(groupResponse.status).toBe(403);
    const userResponse = await POST(request({ targetType: "USERS", userIds: [data.smsUser] }));
    expect(userResponse.status).toBe(403);
    await expect(db.notificationRecipient.count({ where: { userId: data.smsUser } })).resolves.toBe(0);
  });
});
