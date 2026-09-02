import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import { syncCustomerRegistrationEvent } from "../../src/lib/customer-number-event-sync";

const prefix = "cross-group-event-test-";

afterEach(async () => {
  await db.dailyStatEntry.updateMany({
    where: { groupId: { startsWith: prefix } },
    data: { currentRevisionId: null, approvedRevisionId: null },
  });
  await db.dailyStatRevision.deleteMany({ where: { entry: { groupId: { startsWith: prefix } } } });
  await db.dailyStatEntry.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe("跨组客户的号码事件归属", () => {
  it("专家随客户调到新组后，注册仍记到原接粉来源线且不会保存失败", async () => {
    const suffix = randomUUID();
    const sourceGroupId = `${prefix}source-${suffix}`;
    const currentGroupId = `${prefix}current-${suffix}`;
    const channelId = `${prefix}channel-${suffix}`;
    const receptionId = `${prefix}reception-${suffix}`;
    const expertId = `${prefix}expert-${suffix}`;
    await db.teamGroup.createMany({ data: [
      { id: sourceGroupId, name: "来源组", timezone: "Asia/Shanghai", groupType: "HACKER" },
      { id: currentGroupId, name: "当前组", timezone: "Asia/Shanghai", groupType: "HACKER" },
    ] });
    await db.user.createMany({ data: [
      { id: receptionId, username: receptionId, name: "原接粉", role: "RECEPTION", groupId: sourceGroupId },
      { id: expertId, username: expertId, name: "现专家", role: "EXPERT", groupId: currentGroupId },
    ] });
    await db.channel.create({ data: { id: channelId, groupId: sourceGroupId, name: "原渠道", normalizedName: channelId } });

    await db.$transaction((tx) => syncCustomerRegistrationEvent(tx, {
      phone: "123456",
      ownerId: receptionId,
      attributionOwnerId: receptionId,
      groupOperatorOwnerId: receptionId,
      expertOwnerId: expertId,
      currentGroupId,
      batch: { groupId: sourceGroupId, channelId },
    }, "2026-09-02"));

    await expect(db.dailyStatEntry.findFirstOrThrow({
      where: { groupId: sourceGroupId, businessDate: "2026-09-02", position: "EXPERT" },
      include: { currentRevision: true },
    })).resolves.toMatchObject({
      ownerId: receptionId,
      sourceReceptionId: receptionId,
      currentRevision: { registrationCount: 1 },
    });
  });
});
