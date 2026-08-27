import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnalysisScope } from "../../src/lib/analytics/types";
import { createAnalyticsTestDatabase } from "./helpers/analytics-db";

const temporaryDatabase = await createAnalyticsTestDatabase("overview-query");
const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  groupA: `overview-group-a-${suffix}`,
  groupB: `overview-group-b-${suffix}`,
  channelA: `overview-channel-a-${suffix}`,
  channelB: `overview-channel-b-${suffix}`,
  leadA: `overview-lead-a-${suffix}`,
  memberA: `overview-member-a-${suffix}`,
  memberB: `overview-member-b-${suffix}`,
  otherMember: `overview-other-member-${suffix}`,
};

let db: any;
let loadManagementOverview: typeof import("../../src/lib/analytics/overview").loadManagementOverview;
let replyBatchId = "";
let cumulativeReplyBatchId = "";
let cumulativeFunnelBatchId = "";

const leadScope = (groupId: string): AnalysisScope => ({
  actorId: ids.leadA,
  role: "LEAD",
  groupIds: [groupId],
  groupId,
  requestedForbiddenGroup: false,
  showInsufficient: false,
  sourceDateFrom: "2026-07-14",
  sourceDateTo: "2026-08-12",
  includeInactive: false,
});

beforeAll(async () => {
  process.env.DATABASE_URL = temporaryDatabase.databaseUrl;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  ({ loadManagementOverview } =
    await import("../../src/lib/analytics/overview"));

  await db.teamGroup.createMany({
    data: [
      { id: ids.groupA, name: "一组" },
      { id: ids.groupB, name: "二组" },
    ],
  });
  await db.channel.createMany({
    data: [
      {
        id: ids.channelA,
        name: "抖音直播",
        normalizedName: "抖音直播",
        groupId: ids.groupA,
      },
      {
        id: ids.channelB,
        name: "其他渠道",
        normalizedName: "其他渠道",
        groupId: ids.groupB,
      },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: ids.leadA,
        username: ids.leadA,
        name: "组长 A",
        passwordHash: "test",
        role: "LEAD",
        groupId: ids.groupA,
      },
      {
        id: ids.memberA,
        username: ids.memberA,
        name: "成员 A",
        passwordHash: "test",
        role: "RECEPTION",
        groupId: ids.groupA,
      },
      {
        id: ids.memberB,
        username: ids.memberB,
        name: "成员 B",
        passwordHash: "test",
        role: "RECEPTION",
        groupId: ids.groupA,
      },
      {
        id: ids.otherMember,
        username: ids.otherMember,
        name: "其他组成员",
        passwordHash: "test",
        role: "RECEPTION",
        groupId: ids.groupB,
      },
    ],
  });
  const [
    resultsBatch,
    replyBatch,
    anomalyBatch,
    cumulativeReplyBatch,
    cumulativeFunnelBatch,
    oldBatch,
    otherBatch,
  ] = await Promise.all([
    db.sourceBatch.create({
      data: {
        groupId: ids.groupA,
        channelId: ids.channelA,
        sourceDate: "2026-08-10",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.groupA,
        channelId: ids.channelA,
        sourceDate: "2026-08-11",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.groupA,
        channelId: ids.channelA,
        sourceDate: "2026-08-12",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.groupA,
        channelId: ids.channelA,
        sourceDate: "2026-08-09",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.groupA,
        channelId: ids.channelA,
        sourceDate: "2026-08-08",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.groupA,
        channelId: ids.channelA,
        sourceDate: "2026-07-20",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.groupB,
        channelId: ids.channelB,
        sourceDate: "2026-08-12",
      },
    }),
  ]);
  replyBatchId = replyBatch.id;
  cumulativeReplyBatchId = cumulativeReplyBatch.id;
  cumulativeFunnelBatchId = cumulativeFunnelBatch.id;
  await db.metricEvent.createMany({
    data: [
      {
        batchId: resultsBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-10",
        kind: "NEW_FANS",
        quantity: 20,
      },
      {
        batchId: resultsBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-11",
        kind: "NEW_FANS",
        quantity: 20,
      },
      {
        batchId: resultsBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-11",
        kind: "ORDER",
        quantity: 2,
      },
      {
        batchId: resultsBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-12",
        kind: "RECHARGE",
        amountCents: 80000,
      },
      {
        batchId: replyBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-12",
        kind: "REPLIES",
        quantity: 3,
      },
      {
        batchId: anomalyBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-12",
        kind: "REGISTRATION",
        quantity: 2,
      },
      {
        batchId: anomalyBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-12",
        kind: "GROUP_LEAVE",
        quantity: 4,
      },
      {
        batchId: cumulativeReplyBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-11",
        kind: "NEW_FANS",
        quantity: 5,
      },
      {
        batchId: cumulativeReplyBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-12",
        kind: "REPLIES",
        quantity: 3,
      },
      {
        batchId: cumulativeFunnelBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-11",
        kind: "NEW_FANS",
        quantity: 10,
      },
      {
        batchId: cumulativeFunnelBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-11",
        kind: "GROUP_JOIN",
        quantity: 8,
      },
      {
        batchId: cumulativeFunnelBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-11",
        kind: "EXPERT_INTRO",
        quantity: 5,
      },
      {
        batchId: cumulativeFunnelBatch.id,
        enteredById: ids.memberA,
        occurredOn: "2026-08-12",
        kind: "REGISTRATION",
        quantity: 2,
      },
      {
        batchId: oldBatch.id,
        enteredById: ids.memberB,
        occurredOn: "2026-08-05",
        kind: "NEW_FANS",
        quantity: 7,
      },
      {
        batchId: otherBatch.id,
        enteredById: ids.otherMember,
        occurredOn: "2026-08-12",
        kind: "NEW_FANS",
        quantity: 999,
      },
    ],
  });
  await db.dailyEntryConfirmation.create({
    data: { userId: ids.leadA, businessDate: "2026-08-12" },
  });
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await temporaryDatabase.cleanup();
});

describe("management overview query", () => {
  it("summarizes seven occurrence days and limits today's alerts to the lead's readable group", async () => {
    const result = await loadManagementOverview(
      leadScope(ids.groupA),
      "2026-08-12",
      new Date("2026-08-12T15:00:00Z"),
    );

    expect(result.summary).toMatchObject({
      newFans: 55,
      orders: 2,
      rechargeCents: 80000,
      orderRate: 2 / 55,
    });
    expect(result.alerts.unconfirmed.map((item) => item.userId)).toContain(
      ids.memberA,
    );
    expect(result.alerts.unconfirmed.map((item) => item.userId)).not.toContain(
      ids.leadA,
    );
    expect(result.alerts.unconfirmed.map((item) => item.userId)).not.toContain(
      ids.otherMember,
    );
    expect(result.alerts.noRecords3Days).toContainEqual(
      expect.objectContaining({ userId: ids.memberB }),
    );
    expect(result.alerts.replyWithoutFans).toContainEqual(
      expect.objectContaining({ batchId: replyBatchId, count: 3 }),
    );
    expect(
      result.alerts.replyWithoutFans.find(
        (alert) => alert.batchId === cumulativeReplyBatchId,
      ),
    ).toBeUndefined();
    expect(result.alerts.funnelAnomalies).toContainEqual(
      expect.objectContaining({ reason: "注册大于推专家" }),
    );
    expect(
      result.alerts.funnelAnomalies.find(
        (alert) => alert.batchId === cumulativeFunnelBatchId,
      ),
    ).toBeUndefined();
    expect(
      [
        ...result.alerts.funnelAnomalies,
        ...result.alerts.excessiveLeaves,
      ].filter(
        (alert) =>
          alert.batchId === result.alerts.excessiveLeaves[0]?.batchId &&
          alert.memberId === ids.memberA &&
          alert.reason === "退群大于入群",
      ),
    ).toHaveLength(1);
    expect(result.trend).toHaveLength(7);
  });
});
