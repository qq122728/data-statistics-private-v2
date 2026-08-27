import { describe, expect, it } from "vitest";
import { db, getOrCreateSourceBatch, refreshAdvertisingBatchCost } from "../../src/lib/db";

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

  it("freezes the channel price on each source batch", async () => {
    const channelId = "test-price-snapshot-channel";
    await db.sourceBatch.deleteMany({ where: { channelId } });
    await db.channel.deleteMany({ where: { id: channelId } });
    await db.channel.create({
      data: {
        id: channelId,
        groupId: "group-a",
        name: "历史价格测试渠道",
        normalizedName: "历史价格测试渠道",
        fanCostMode: "PAID",
        effectiveFanPriceCents: 200,
      },
    });
    const oldBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-14" });
    await db.channel.update({
      where: { id_groupId: { id: channelId, groupId: "group-a" } },
      data: { effectiveFanPriceCents: 300 },
    });
    const sameBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-14" });
    const newBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-15" });
    expect(sameBatch.effectiveFanPriceCentsSnapshot).toBe(200);
    expect(oldBatch.effectiveFanPriceCentsSnapshot).toBe(200);
    expect(newBatch.effectiveFanPriceCentsSnapshot).toBe(300);
  });

  it("calculates and freezes an ads batch price from spend plus 15% service fee", async () => {
    const channelId = "test-ads-price-channel";
    await db.sourceBatch.deleteMany({ where: { channelId } });
    await db.channel.deleteMany({ where: { id: channelId } });
    await db.channel.create({
      data: {
        id: channelId,
        groupId: "group-a",
        name: "投流测试渠道",
        normalizedName: "投流测试渠道",
        channelType: "ADS",
        fanCostMode: "PAID",
      },
    });

    const batch = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId,
      sourceDate: "2026-08-16",
      advertisingSpendCents: 10_000,
      advertisingFanCount: 10,
    });

    expect(batch.effectiveFanPriceCentsSnapshot).toBe(1_150);
    expect(batch.advertisingSpendCents).toBe(10_000);
    expect(batch.advertisingFanCount).toBe(10);
    expect(batch.advertisingServiceFeeRateBps).toBe(1_500);
    const sharedBatch = await getOrCreateSourceBatch({
      groupId: "group-a",
      channelId,
      sourceDate: "2026-08-16",
      advertisingSpendCents: 10_000,
      advertisingFanCount: 10,
    });
    expect(sharedBatch.id).toBe(batch.id);
    expect(sharedBatch.effectiveFanPriceCentsSnapshot).toBe(1_150);
  });

  it("recalculates one shared ads cost from all receptionists' effective imports", async () => {
    const channelId = "test-shared-ads-cost-channel";
    const receptionists = ["shared-ads-reception-a", "shared-ads-reception-b", "shared-ads-reception-c"];
    await db.sourceBatch.deleteMany({ where: { channelId } });
    await db.channel.deleteMany({ where: { id: channelId } });
    await db.user.createMany({ data: receptionists.map((id) => ({ id, username: id, name: id, role: "RECEPTION", groupId: "group-a" })) });
    await db.channel.create({ data: { id: channelId, groupId: "group-a", name: "共享投流成本", normalizedName: "共享投流成本", channelType: "ADS", fanCostMode: "PAID" } });
    const batch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-19", advertisingSpendCents: 11_500, advertisingFanCount: 0 });
    await db.metricEvent.createMany({ data: [
      { batchId: batch.id, enteredById: receptionists[0], occurredOn: "2026-08-19", kind: "EFFECTIVE_FANS", quantity: 30, derivedFromLedger: true },
      { batchId: batch.id, enteredById: receptionists[1], occurredOn: "2026-08-19", kind: "EFFECTIVE_FANS", quantity: 40, derivedFromLedger: true },
      { batchId: batch.id, enteredById: receptionists[2], occurredOn: "2026-08-19", kind: "EFFECTIVE_FANS", quantity: 30, derivedFromLedger: true },
    ] });

    await expect(refreshAdvertisingBatchCost(batch.id)).resolves.toMatchObject({
      advertisingFanCount: 100,
      advertisingSpendCents: 11_500,
      effectiveFanPriceCentsSnapshot: 132,
    });
  });

  it("freezes a rebate channel type and rate so later channel edits cannot rewrite old results", async () => {
    const channelId = "test-rebate-snapshot-channel";
    await db.sourceBatch.deleteMany({ where: { channelId } });
    await db.channel.deleteMany({ where: { id: channelId } });
    await db.channel.create({
      data: {
        id: channelId,
        groupId: "group-a",
        name: "底料快照测试",
        normalizedName: "底料快照测试",
        channelType: "REBATE",
        fanCostMode: "FREE",
        effectiveFanPriceCents: 0,
        rebateRateBps: 3_000,
      },
    });
    const oldBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-17" });
    await db.channel.update({
      where: { id_groupId: { id: channelId, groupId: "group-a" } },
      data: { rebateRateBps: 2_000 },
    });
    const sameBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-17" });
    const newBatch = await getOrCreateSourceBatch({ groupId: "group-a", channelId, sourceDate: "2026-08-18" });
    expect(oldBatch).toMatchObject({ channelTypeSnapshot: "REBATE", rebateRateBpsSnapshot: 3_000, fanCostModeSnapshot: "FREE", effectiveFanPriceCentsSnapshot: 0 });
    expect(sameBatch.rebateRateBpsSnapshot).toBe(3_000);
    expect(newBatch.rebateRateBpsSnapshot).toBe(2_000);
  });
});
