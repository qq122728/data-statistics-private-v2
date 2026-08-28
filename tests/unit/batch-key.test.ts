import { describe, expect, it } from "vitest";
import { db, getOrCreateSourceBatch } from "../../src/lib/db";

describe("source batch keys", () => {
  it("uses date, channel and group as one source batch key", async () => {
    const first = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId: "channel-1",
      sourceDate: "2026-08-10",
    });
    const second = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId: "channel-1",
      sourceDate: "2026-08-10",
    });
    const changedDate = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId: "channel-1",
      sourceDate: "2026-08-11",
    });
    const changedGroupAndChannel = await getOrCreateSourceBatch({
      groupId: "group-b",
      channelId: "channel-2",
      sourceDate: "2026-08-10",
    });

    expect(second.id).toBe(first.id);
    expect(changedDate.id).not.toBe(first.id);
    expect(changedGroupAndChannel.id).not.toBe(first.id);
  });

  it("rejects a channel that belongs to another group", async () => {
    await expect(
      getOrCreateSourceBatch({
        groupId: "group-a",
        channelId: "channel-2",
        sourceDate: "2026-08-12",
      }),
    ).rejects.toThrow();
  });

  it("creates a different batch when only the channel changes", async () => {
    await db.sourceBatch.deleteMany({
      where: { channelId: { in: ["test-channel-a", "test-channel-a-alt"] } },
    });
    await db.channel.deleteMany({
      where: { id: { in: ["test-channel-a", "test-channel-a-alt"] } },
    });
    await db.channel.createMany({
      data: [
        { id: "test-channel-a", name: "测试渠道 A", normalizedName: "测试渠道 a", groupId: "group-a" },
        { id: "test-channel-a-alt", name: "测试渠道 A 备用", normalizedName: "测试渠道 a 备用", groupId: "group-a" },
      ],
    });

    const first = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId: "test-channel-a",
      sourceDate: "2026-08-13",
    });
    const changedChannel = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId: "test-channel-a-alt",
      sourceDate: "2026-08-13",
    });

    expect(changedChannel.id).not.toBe(first.id);
  });

  it("creates a different batch when only the group changes", async () => {
    await db.sourceBatch.deleteMany({
      where: { channelId: "test-shared-channel" },
    });
    await db.channel.deleteMany({
      where: { id: "test-shared-channel" },
    });
    await db.channel.createMany({
      data: [
        { id: "test-shared-channel", name: "共享测试渠道", normalizedName: "共享测试渠道", groupId: "group-a" },
        { id: "test-shared-channel", name: "共享测试渠道", normalizedName: "共享测试渠道", groupId: "group-b" },
      ],
    });

    const first = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId: "test-shared-channel",
      sourceDate: "2026-08-13",
    });
    const changedGroup = await getOrCreateSourceBatch({
      groupId: "group-b",
      channelId: "test-shared-channel",
      sourceDate: "2026-08-13",
    });

    expect(changedGroup.id).not.toBe(first.id);
  });

  it("freezes the channel type on each source batch so later channel edits cannot rewrite old results", async () => {
    const channelId = "test-channel-type-snapshot-channel";
    await db.sourceBatch.deleteMany({ where: { channelId } });
    await db.channel.deleteMany({ where: { id: channelId } });
    await db.channel.create({
      data: {
        id: channelId,
        groupId: "group-a",
        name: "渠道类型快照测试",
        normalizedName: "渠道类型快照测试",
        channelType: "REBATE",
      },
    });
    const oldBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-17" });
    expect(oldBatch.channelTypeSnapshot).toBe("REBATE");
    const sameBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-17" });
    expect(sameBatch.channelTypeSnapshot).toBe("REBATE");
  });

  it("lets multiple receptionists share one batch under the same channel and date", async () => {
    const channelId = "test-shared-batch-channel";
    const receptionists = ["shared-batch-reception-a", "shared-batch-reception-b"];
    await db.metricEvent.deleteMany({ where: { batch: { channelId } } });
    await db.sourceBatch.deleteMany({ where: { channelId } });
    await db.channel.deleteMany({ where: { id: channelId } });
    await db.user.createMany({ data: receptionists.map((id) => ({ id, username: id, name: id, role: "RECEPTION", groupId: "group-a" })) });
    await db.channel.create({ data: { id: channelId, groupId: "group-a", name: "共享批次测试", normalizedName: "共享批次测试", channelType: "ADS" } });
    const first = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-19" });
    const second = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-19" });
    expect(second.id).toBe(first.id);

    await db.metricEvent.createMany({ data: receptionists.map((enteredById) => ({
      batchId: second.id, enteredById, occurredOn: "2026-08-19", kind: "EFFECTIVE_FANS", quantity: 1,
    })) });
    const events = await db.metricEvent.findMany({ where: { batchId: first.id }, select: { enteredById: true } });
    expect(new Set(events.map((event) => event.enteredById))).toEqual(new Set(receptionists));
  });
});
