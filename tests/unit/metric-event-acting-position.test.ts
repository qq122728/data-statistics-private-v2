import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import { recordMetricEvent, recordMetricEvents } from "../../src/lib/metric-events";

const prefix = "metric-event-acting-position-";

async function fixture() {
  const groupId = `${prefix}group-${randomUUID()}`;
  const userId = `${prefix}user-${randomUUID()}`;
  const channelId = `${prefix}channel-${randomUUID()}`;
  await db.teamGroup.create({ data: { id: groupId, name: `冻结测试组-${randomUUID()}` } });
  await db.user.create({ data: { id: userId, username: `${prefix}${randomUUID()}`, name: "冻结测试成员", role: "RECEPTION", groupId } });
  await db.channel.create({ data: { id: channelId, groupId, name: "冻结测试渠道", normalizedName: `${prefix}${randomUUID()}` } });
  const batch = await db.sourceBatch.create({ data: { groupId, channelId, sourceDate: "2026-08-10" } });
  return { groupId, userId, batchId: batch.id };
}

afterEach(async () => {
  await db.metricEvent.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.userPosition.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe("recordMetricEvent 冻结 actingPosition", () => {
  it("没有 UserPosition 记录时写入 null，不报错", async () => {
    const { userId, batchId } = await fixture();
    const event = await recordMetricEvent(db, { batchId, enteredById: userId, occurredOn: "2026-08-10", kind: "NEW_FANS", quantity: 1 });
    expect(event.actingPosition).toBeNull();
  });

  it("按 enteredById 当前生效的 UserPosition 冻结写入", async () => {
    const { userId, batchId, groupId } = await fixture();
    await db.userPosition.create({ data: { userId, groupId, position: "RECEPTION", effectiveFrom: "2026-08-01" } });
    const event = await recordMetricEvent(db, { batchId, enteredById: userId, occurredOn: "2026-08-10", kind: "NEW_FANS", quantity: 1 });
    expect(event.actingPosition).toBe("RECEPTION");
  });

  it("调岗后新事件用新岗位，旧事件的岗位归属不变", async () => {
    const { userId, batchId, groupId } = await fixture();
    await db.userPosition.create({ data: { userId, groupId, position: "RECEPTION", effectiveFrom: "2026-08-01" } });
    const before = await recordMetricEvent(db, { batchId, enteredById: userId, occurredOn: "2026-08-10", kind: "NEW_FANS", quantity: 1 });
    expect(before.actingPosition).toBe("RECEPTION");

    // 模拟 transferUserPosition 的冻结写法：关闭旧行、开一条新的。
    await db.userPosition.update({ where: { userId_effectiveFrom: { userId, effectiveFrom: "2026-08-01" } }, data: { effectiveTo: "2026-08-14" } });
    await db.userPosition.create({ data: { userId, groupId, position: "EXPERT", effectiveFrom: "2026-08-15" } });

    const after = await recordMetricEvent(db, { batchId, enteredById: userId, occurredOn: "2026-08-20", kind: "REGISTRATION", quantity: 1 });
    expect(after.actingPosition).toBe("EXPERT");

    const beforeReloaded = await db.metricEvent.findUniqueOrThrow({ where: { id: before.id }, select: { actingPosition: true } });
    expect(beforeReloaded.actingPosition).toBe("RECEPTION");
  });

  it("recordMetricEvents 按每笔各自的 enteredById 分别查岗位", async () => {
    const { userId, batchId, groupId } = await fixture();
    const otherUserId = `${prefix}user-${randomUUID()}`;
    await db.user.create({ data: { id: otherUserId, username: `${prefix}${randomUUID()}`, name: "冻结测试成员二", role: "GROUP_OPERATOR", groupId } });
    await db.userPosition.create({ data: { userId, groupId, position: "RECEPTION", effectiveFrom: "2026-08-01" } });
    await db.userPosition.create({ data: { userId: otherUserId, groupId, position: "GROUP_OPERATOR", effectiveFrom: "2026-08-01" } });

    await recordMetricEvents(db, [
      { batchId, enteredById: userId, occurredOn: "2026-08-10", kind: "NEW_FANS", quantity: 3 },
      { batchId, enteredById: otherUserId, occurredOn: "2026-08-10", kind: "GROUP_JOIN", quantity: 2 },
    ]);

    const events = await db.metricEvent.findMany({ where: { batchId }, select: { enteredById: true, actingPosition: true } });
    expect(events.find((event) => event.enteredById === userId)?.actingPosition).toBe("RECEPTION");
    expect(events.find((event) => event.enteredById === otherUserId)?.actingPosition).toBe("GROUP_OPERATOR");
  });
});
