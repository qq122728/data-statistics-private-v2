import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/reports/route";

const { buildReport } = GET;

const ids = {
  group: "report-query-group",
  otherGroup: "report-query-other-group",
  channel: "report-query-channel",
  otherChannel: "report-query-other-channel",
  user: "report-query-user",
  otherUser: "report-query-other-user",
};

afterEach(async () => {
  vi.useRealTimers();
  await db.metricEvent.deleteMany({ where: { batch: { groupId: { in: [ids.group, ids.otherGroup] } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { in: [ids.group, ids.otherGroup] } } });
  await db.channel.deleteMany({ where: { groupId: { in: [ids.group, ids.otherGroup] } } });
  await db.user.deleteMany({ where: { id: { in: [ids.user, ids.otherUser] } } });
  await db.teamGroup.deleteMany({ where: { id: { in: [ids.group, ids.otherGroup] } } });
});

describe("report query", () => {
  it("excludes events after the local current date from a cumulative source cohort", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T19:00:00.000Z"));
    await db.teamGroup.create({ data: { id: ids.group, name: "报表测试小组" } });
    await db.channel.create({ data: { id: ids.channel, name: "渠道 1", normalizedName: "渠道 1", groupId: ids.group } });
    await db.user.create({ data: { id: ids.user, username: ids.user, name: "报表测试用户", passwordHash: "hash", role: "ADMIN" } });
    const batch = await db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-08" } });
    await db.metricEvent.createMany({ data: [
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 10 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-10", kind: "REPLIES", quantity: 4 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-11", kind: "GROUP_JOIN", quantity: 6 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-12", kind: "GROUP_LEAVE", quantity: 1 },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "ADMIN", groupId: null, active: true },
      groupId: ids.group,
      sourceDateFrom: "2026-08-08",
      sourceDateTo: "2026-08-08",
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      label: "2026-08-08 · 渠道 1",
      totals: { newFans: 10, replies: 4, groupJoin: 6, groupLeave: 0, inGroup: 6 },
    });
  });

  it("excludes voided orders and financial events from legacy report totals", async () => {
    await db.teamGroup.create({ data: { id: ids.group, name: "报表测试小组" } });
    await db.channel.create({ data: { id: ids.channel, name: "渠道 1", normalizedName: "渠道 1", groupId: ids.group } });
    await db.user.create({ data: { id: ids.user, username: ids.user, name: "报表测试用户", passwordHash: "hash", role: "ADMIN" } });
    const batch = await db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-08" } });
    const voidedAt = new Date("2026-08-12T00:00:00.000Z");
    await db.metricEvent.createMany({ data: [
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "ORDER", quantity: 1 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "ORDER", quantity: 9, voidedAt },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "RECHARGE", amountCents: 10_000 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "RECHARGE", amountCents: 90_000, voidedAt },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "WITHDRAWAL", amountCents: 2_000 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "WITHDRAWAL", amountCents: 20_000, voidedAt },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "ADMIN", groupId: null, active: true },
      groupId: ids.group,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.totals).toMatchObject({
      orders: 1,
      rechargeCents: 10_000,
      withdrawalCents: 2_000,
    });
  });

  it("does not show a reception member a legacy batch supported only by voided events", async () => {
    await db.teamGroup.create({ data: { id: ids.group, name: "报表测试小组" } });
    await db.channel.create({ data: { id: ids.channel, name: "渠道 1", normalizedName: "渠道 1", groupId: ids.group } });
    await db.user.create({ data: { id: ids.user, username: ids.user, name: "报表测试用户", passwordHash: "hash", role: "RECEPTION", groupId: ids.group } });
    const batch = await db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-08" } });
    await db.metricEvent.create({
      data: {
        batchId: batch.id,
        enteredById: ids.user,
        occurredOn: "2026-08-08",
        kind: "ORDER",
        quantity: 1,
        voidedAt: new Date("2026-08-12T00:00:00.000Z"),
      },
    });

    const report = await buildReport({
      user: { id: ids.user, role: "RECEPTION", groupId: ids.group, active: true },
      groupId: ids.group,
    });

    expect(report.rows).toEqual([]);
  });

  it("returns only newly occurred events when an occurrence-date range is selected", async () => {
    await db.teamGroup.create({ data: { id: ids.group, name: "报表测试小组" } });
    await db.channel.create({ data: { id: ids.channel, name: "渠道 1", normalizedName: "渠道 1", groupId: ids.group } });
    await db.user.create({ data: { id: ids.user, username: ids.user, name: "报表测试用户", passwordHash: "hash", role: "ADMIN" } });
    const batch = await db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-08" } });
    await db.metricEvent.createMany({ data: [
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 10 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-10", kind: "REPLIES", quantity: 4 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-11", kind: "GROUP_JOIN", quantity: 6 },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "ADMIN", groupId: null, active: true },
      groupId: ids.group,
      occurredDateFrom: "2026-08-10",
      occurredDateTo: "2026-08-10",
    });

    expect(report).toMatchObject({ mode: "incremental" });
    expect(report.rows[0]?.totals).toMatchObject({ newFans: 0, replies: 4, groupJoin: 0, inGroup: 0 });
    expect(report.rows[0]?.rates).toBeNull();
  });

  it("caps an explicit occurrence-date range at the local current date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T19:00:00.000Z"));
    await db.teamGroup.create({ data: { id: ids.group, name: "报表测试小组" } });
    await db.channel.create({ data: { id: ids.channel, name: "渠道 1", normalizedName: "渠道 1", groupId: ids.group } });
    await db.user.create({ data: { id: ids.user, username: ids.user, name: "报表测试用户", passwordHash: "hash", role: "ADMIN" } });
    const batch = await db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-08" } });
    await db.metricEvent.createMany({ data: [
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-11", kind: "REPLIES", quantity: 4 },
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-12", kind: "GROUP_JOIN", quantity: 9 },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "ADMIN", groupId: null, active: true },
      groupId: ids.group,
      occurredDateFrom: "2026-08-11",
      occurredDateTo: "2026-08-20",
      timeZone: "UTC",
    });

    expect(report.mode).toBe("incremental");
    expect(report.rows[0]?.totals).toMatchObject({ replies: 4, groupJoin: 0 });
  });

  it("limits a readable group report to the selected member's entries", async () => {
    await db.teamGroup.create({ data: { id: ids.group, name: "报表测试小组" } });
    await db.channel.create({ data: { id: ids.channel, name: "渠道 1", normalizedName: "渠道 1", groupId: ids.group } });
    await db.user.createMany({ data: [
      { id: ids.user, username: ids.user, name: "报表测试用户", passwordHash: "hash", role: "LEAD", groupId: ids.group },
      { id: ids.otherUser, username: ids.otherUser, name: "另一位用户", passwordHash: "hash", role: "RECEPTION", groupId: ids.group },
    ] });
    const batch = await db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-08" } });
    await db.metricEvent.createMany({ data: [
      { batchId: batch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 10 },
      { batchId: batch.id, enteredById: ids.otherUser, occurredOn: "2026-08-10", kind: "REPLIES", quantity: 7 },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "LEAD", groupId: ids.group, active: true },
      groupId: ids.group,
      memberId: ids.user,
      channelId: ids.channel,
    });

    expect(report.rows[0]?.totals).toMatchObject({ newFans: 10, replies: 0 });
  });

  it("returns no rows when a member forges an unreadable group filter", async () => {
    await db.teamGroup.createMany({ data: [
      { id: ids.group, name: "报表测试小组" },
      { id: ids.otherGroup, name: "其他小组" },
    ] });
    await db.channel.createMany({ data: [
      { id: ids.channel, name: "渠道 1", normalizedName: "渠道 1", groupId: ids.group },
      { id: ids.otherChannel, name: "渠道 2", normalizedName: "渠道 2", groupId: ids.otherGroup },
    ] });
    await db.user.createMany({ data: [
      { id: ids.user, username: ids.user, name: "组员", passwordHash: "hash", role: "RECEPTION", groupId: ids.group },
      { id: ids.otherUser, username: ids.otherUser, name: "另一位用户", passwordHash: "hash", role: "LEAD", groupId: ids.otherGroup },
    ] });
    const [ownBatch, otherBatch, forbiddenBatch] = await Promise.all([
      db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-08" } }),
      db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-09" } }),
      db.sourceBatch.create({ data: { groupId: ids.otherGroup, channelId: ids.otherChannel, sourceDate: "2026-08-08" } }),
    ]);
    await db.metricEvent.createMany({ data: [
      { batchId: ownBatch.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 3 },
      { batchId: otherBatch.id, enteredById: ids.otherUser, occurredOn: "2026-08-09", kind: "NEW_FANS", quantity: 8 },
      { batchId: forbiddenBatch.id, enteredById: ids.otherUser, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 99 },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "RECEPTION", groupId: ids.group, active: true },
      groupId: ids.otherGroup,
      memberId: ids.otherUser,
    });

    expect(report.rows).toEqual([]);
  });

  it("does not let a lead query a forged group or member outside their scope", async () => {
    await db.teamGroup.createMany({ data: [
      { id: ids.group, name: "报表测试小组" },
      { id: ids.otherGroup, name: "其他小组" },
    ] });
    await db.channel.create({ data: { id: ids.otherChannel, name: "渠道 2", normalizedName: "渠道 2", groupId: ids.otherGroup } });
    await db.user.createMany({ data: [
      { id: ids.user, username: ids.user, name: "组长", passwordHash: "hash", role: "LEAD", groupId: ids.group },
      { id: ids.otherUser, username: ids.otherUser, name: "另一位用户", passwordHash: "hash", role: "RECEPTION", groupId: ids.otherGroup },
    ] });
    const batch = await db.sourceBatch.create({ data: { groupId: ids.otherGroup, channelId: ids.otherChannel, sourceDate: "2026-08-08" } });
    await db.metricEvent.create({ data: { batchId: batch.id, enteredById: ids.otherUser, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 99 } });

    const report = await buildReport({
      user: { id: ids.user, role: "LEAD", groupId: ids.group, active: true },
      groupId: ids.otherGroup,
      memberId: ids.otherUser,
    });

    expect(report.rows).toEqual([]);
  });

  it("filters equal normalized channel sources across readable groups without relying on channel ids", async () => {
    await db.teamGroup.createMany({ data: [
      { id: ids.group, name: "报表测试小组" },
      { id: ids.otherGroup, name: "其他小组" },
    ] });
    await db.channel.createMany({ data: [
      { id: "shared-channel", name: " 抖音直播 ", normalizedName: "抖音直播", groupId: ids.group },
      { id: ids.otherChannel, name: "抖音直播", normalizedName: "抖音直播", groupId: ids.otherGroup },
      { id: "shared-channel", name: "其他来源", normalizedName: "其他来源", groupId: ids.otherGroup },
    ] });
    await db.user.create({ data: { id: ids.user, username: ids.user, name: "管理员", passwordHash: "hash", role: "ADMIN" } });
    const [first, second, unrelated] = await Promise.all([
      db.sourceBatch.create({ data: { groupId: ids.group, channelId: "shared-channel", sourceDate: "2026-08-08" } }),
      db.sourceBatch.create({ data: { groupId: ids.otherGroup, channelId: ids.otherChannel, sourceDate: "2026-08-08" } }),
      db.sourceBatch.create({ data: { groupId: ids.otherGroup, channelId: "shared-channel", sourceDate: "2026-08-08" } }),
    ]);
    await db.metricEvent.createMany({ data: [
      { batchId: first.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 2 },
      { batchId: second.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 3 },
      { batchId: unrelated.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 99 },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "ADMIN", groupId: null, active: true },
      normalizedName: " 抖音直播 ",
    });

    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((row) => row.group.id)).toEqual(expect.arrayContaining([ids.group, ids.otherGroup]));
    expect(report.rows.reduce((total, row) => total + row.totals.newFans, 0)).toBe(5);
  });

  it("does not combine different sources that reuse a legacy channel id across groups", async () => {
    await db.teamGroup.createMany({ data: [
      { id: ids.group, name: "报表测试小组" },
      { id: ids.otherGroup, name: "其他小组" },
    ] });
    await db.channel.createMany({ data: [
      { id: "shared-channel", name: "抖音直播", normalizedName: "抖音直播", groupId: ids.group },
      { id: "shared-channel", name: "其他来源", normalizedName: "其他来源", groupId: ids.otherGroup },
    ] });
    await db.user.create({ data: { id: ids.user, username: ids.user, name: "管理员", passwordHash: "hash", role: "ADMIN" } });
    const [first, second] = await Promise.all([
      db.sourceBatch.create({ data: { groupId: ids.group, channelId: "shared-channel", sourceDate: "2026-08-08" } }),
      db.sourceBatch.create({ data: { groupId: ids.otherGroup, channelId: "shared-channel", sourceDate: "2026-08-08" } }),
    ]);
    await db.metricEvent.createMany({ data: [
      { batchId: first.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 2 },
      { batchId: second.id, enteredById: ids.user, occurredOn: "2026-08-08", kind: "NEW_FANS", quantity: 99 },
    ] });

    const report = await buildReport({
      user: { id: ids.user, role: "ADMIN", groupId: null, active: true },
      channelId: "shared-channel",
    });

    expect(report).toMatchObject({ rows: [], filterWarning: "AMBIGUOUS_LEGACY_CHANNEL_ID" });
  });
});
