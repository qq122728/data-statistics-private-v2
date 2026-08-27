import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnalysisScope } from "../../src/lib/analytics/types";
import { createAnalyticsTestDatabase } from "./helpers/analytics-db";

const temporaryDatabase = await createAnalyticsTestDatabase("channel-analysis-query");
const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  groupA: `channel-group-a-${suffix}`,
  groupB: `channel-group-b-${suffix}`,
  leadA: `channel-lead-a-${suffix}`,
  memberB: `channel-member-b-${suffix}`,
};

let db: any;
let loadChannelAnalysis: typeof import("../../src/lib/analytics/channel-analysis").loadChannelAnalysis;

const adminScope = (overrides: Partial<AnalysisScope> = {}): AnalysisScope => ({
  actorId: "admin",
  role: "ADMIN",
  groupIds: [ids.groupA, ids.groupB],
  requestedForbiddenGroup: false,
  showInsufficient: false,
  sourceDateFrom: "2026-07-14",
  sourceDateTo: "2026-08-12",
  includeInactive: false,
  ...overrides,
});

beforeAll(async () => {
  process.env.DATABASE_URL = temporaryDatabase.databaseUrl;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  ({ loadChannelAnalysis } = await import("../../src/lib/analytics/channel-analysis"));

  await db.teamGroup.createMany({ data: [{ id: ids.groupA, name: "一组" }, { id: ids.groupB, name: "二组" }] });
  await db.user.createMany({ data: [
    { id: ids.leadA, username: ids.leadA, name: "前台接粉 A", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA },
    { id: ids.memberB, username: ids.memberB, name: "成员 B", passwordHash: "test", role: "RECEPTION", groupId: ids.groupB },
  ] });
  await db.channel.createMany({ data: [
    { id: "shared-old-id", name: " 抖音直播 ", normalizedName: "抖音直播", groupId: ids.groupA },
    { id: `douyin-b-${suffix}`, name: "抖音直播", normalizedName: "抖音直播", groupId: ids.groupB },
    { id: "shared-old-id", name: "其他来源", normalizedName: "其他来源", groupId: ids.groupB },
    { id: `xiaohongshu-${suffix}`, name: "小红书", normalizedName: "小红书", groupId: ids.groupA },
  ] });
  const [douyinA, douyinB, unrelated, xiaohongshu] = await Promise.all([
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: "shared-old-id", sourceDate: "2026-07-29" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupB, channelId: `douyin-b-${suffix}`, sourceDate: "2026-08-01" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupB, channelId: "shared-old-id", sourceDate: "2026-08-02" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: `xiaohongshu-${suffix}`, sourceDate: "2026-08-03" } }),
  ]);
  await db.metricEvent.createMany({ data: [
    { batchId: douyinA.id, enteredById: ids.leadA, occurredOn: "2026-07-28", kind: "ORDER", quantity: 9 },
    { batchId: douyinA.id, enteredById: ids.leadA, occurredOn: "2026-07-29", kind: "NEW_FANS", quantity: 15, derivedFromLedger: true },
    { batchId: douyinA.id, enteredById: ids.leadA, occurredOn: "2026-07-29", kind: "NO_NUMBER", quantity: 4, derivedFromLedger: true },
    { batchId: douyinA.id, enteredById: ids.leadA, occurredOn: "2026-08-05", kind: "ORDER", quantity: 1 },
    { batchId: douyinA.id, enteredById: ids.leadA, occurredOn: "2026-08-06", kind: "ORDER", quantity: 2 },
    { batchId: douyinA.id, enteredById: ids.leadA, occurredOn: "2026-08-10", kind: "RECHARGE", amountCents: 25000 },
    { batchId: douyinB.id, enteredById: ids.memberB, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 10 },
    { batchId: douyinB.id, enteredById: ids.memberB, occurredOn: "2026-08-04", kind: "GROUP_JOIN", quantity: 5 },
    { batchId: unrelated.id, enteredById: ids.memberB, occurredOn: "2026-08-02", kind: "NEW_FANS", quantity: 99 },
    { batchId: xiaohongshu.id, enteredById: ids.leadA, occurredOn: "2026-08-03", kind: "NEW_FANS", quantity: 10 },
  ] });
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await temporaryDatabase.cleanup();
});

describe("channel quality query", () => {
  it("merges equal normalized names across groups without merging reused legacy ids", async () => {
    const result = await loadChannelAnalysis(adminScope(), "2026-08-12");
    const douyin = result.rows.find((row) => row.normalizedName === "抖音直播");

    expect(douyin).toMatchObject({ newFans: 25, groups: expect.arrayContaining(["一组", "二组"]), groupCount: 2 });
    expect(douyin?.rankable).toBe(true);
    expect(result.rows.find((row) => row.normalizedName === "小红书")?.rankable).toBe(false);
    expect(result.rows.find((row) => row.normalizedName === "其他来源")?.newFans).toBe(99);
    expect(result.rankableRows.every((row) => row.newFans >= 20)).toBe(true);
  });

  it("keeps D7 and D14 windows distinct in selected channel details", async () => {
    const result = await loadChannelAnalysis(adminScope({ normalizedName: "抖音直播" }), "2026-08-12");
    expect(result.selectedChannelDetail).toMatchObject({
      normalizedName: "抖音直播",
      d7: { totals: { orders: 1 } },
      d14: { totals: { orders: 3, rechargeCents: 25000 } },
    });
  });

  it("does not include a resource manager's unassigned channels", async () => {
    const result = await loadChannelAnalysis(adminScope({
      role: "RESOURCE_MANAGER",
      channelIds: [`xiaohongshu-${suffix}`],
    }), "2026-08-12");

    expect(result.rows.map((row) => row.normalizedName)).toEqual(["小红书"]);
    expect(result.rows[0]?.newFans).toBe(10);
  });

  it("keeps historical no-number data out of the low-amount column", async () => {
    const result = await loadChannelAnalysis(adminScope(), "2026-08-12");
    const douyin = result.rows.find((row) => row.normalizedName === "抖音直播");

    expect(douyin).toMatchObject({ noWs: 4, lowAmount: 0, invalid: 4 });
  });
});
