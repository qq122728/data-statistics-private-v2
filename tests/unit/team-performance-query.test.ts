import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnalysisScope } from "../../src/lib/analytics/types";
import { createAnalyticsTestDatabase } from "./helpers/analytics-db";

const temporaryDatabase = await createAnalyticsTestDatabase("team-performance-query");
const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  groupA: `team-group-a-${suffix}`,
  groupB: `team-group-b-${suffix}`,
  groupC: `team-group-c-${suffix}`,
  channelA: `team-channel-a-${suffix}`,
  channelB: `team-channel-b-${suffix}`,
  admin: `team-admin-${suffix}`,
  leadA: `team-lead-a-${suffix}`,
  memberA: `team-member-a-${suffix}`,
  otherMember: `team-other-member-${suffix}`,
};

let db: any;
let loadTeamPerformance: typeof import("../../src/lib/analytics/team-performance").loadTeamPerformance;

const scope = (role: "ADMIN" | "LEAD", groupIds: string[], groupId?: string): AnalysisScope => ({
  actorId: role === "ADMIN" ? ids.admin : ids.leadA,
  role,
  groupIds,
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
  ({ loadTeamPerformance } = await import("../../src/lib/analytics/team-performance"));

  await db.teamGroup.createMany({ data: [
    { id: ids.groupA, name: "一组" },
    { id: ids.groupB, name: "二组" },
    { id: ids.groupC, name: "三组（无人）" },
  ] });
  await db.channel.createMany({ data: [
    { id: ids.channelA, name: "抖音", normalizedName: "抖音", groupId: ids.groupA },
    { id: ids.channelB, name: "视频号", normalizedName: "视频号", groupId: ids.groupB },
  ] });
  await db.user.createMany({ data: [
    { id: ids.admin, username: ids.admin, name: "管理员", passwordHash: "test", role: "ADMIN" },
    { id: ids.leadA, username: ids.leadA, name: "组长 A", passwordHash: "test", role: "LEAD", groupId: ids.groupA },
    { id: ids.memberA, username: ids.memberA, name: "成员 A", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA },
    { id: ids.otherMember, username: ids.otherMember, name: "其他组成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupB },
  ] });
  const [sharedBatch, recentBatch, otherBatch] = await Promise.all([
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-01" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-10" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupB, channelId: ids.channelB, sourceDate: "2026-08-01" } }),
  ]);
  await db.metricEvent.createMany({ data: [
    { batchId: sharedBatch.id, enteredById: ids.leadA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 25 },
    { batchId: sharedBatch.id, enteredById: ids.leadA, occurredOn: "2026-08-06", kind: "GROUP_JOIN", quantity: 10 },
    { batchId: sharedBatch.id, enteredById: ids.leadA, occurredOn: "2026-08-07", kind: "ORDER", quantity: 1 },
    { batchId: sharedBatch.id, enteredById: ids.leadA, occurredOn: "2026-08-07", kind: "RECHARGE", amountCents: 10000 },
    { batchId: sharedBatch.id, enteredById: ids.memberA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 20 },
    { batchId: sharedBatch.id, enteredById: ids.memberA, occurredOn: "2026-08-01", kind: "DUPLICATE_FANS", quantity: 3, derivedFromLedger: true },
    { batchId: sharedBatch.id, enteredById: ids.memberA, occurredOn: "2026-08-06", kind: "GROUP_JOIN", quantity: 12 },
    { batchId: sharedBatch.id, enteredById: ids.memberA, occurredOn: "2026-08-07", kind: "ORDER", quantity: 2 },
    { batchId: sharedBatch.id, enteredById: ids.memberA, occurredOn: "2026-08-07", kind: "RECHARGE", amountCents: 30000 },
    { batchId: recentBatch.id, enteredById: ids.leadA, occurredOn: "2026-08-10", kind: "NEW_FANS", quantity: 100 },
    { batchId: recentBatch.id, enteredById: ids.leadA, occurredOn: "2026-08-12", kind: "ORDER", quantity: 100 },
    { batchId: otherBatch.id, enteredById: ids.otherMember, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 99 },
    { batchId: otherBatch.id, enteredById: ids.admin, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 999 },
  ] });
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await temporaryDatabase.cleanup();
});

describe("team performance query", () => {
  it("shows only business people and keeps owner totals separate inside one batch", async () => {
    const result = await loadTeamPerformance(scope("ADMIN", [ids.groupA, ids.groupB, ids.groupC]), "2026-08-12");

    expect(result.groupRows.find((row) => row.groupId === ids.groupA)).toMatchObject({ activePeople: 1, averageOrders: 2, sampleState: "RANKABLE" });
    expect(result.memberRows.find((row) => row.userId === ids.leadA)).toBeUndefined();
    expect(result.memberRows.find((row) => row.userId === ids.memberA)).toMatchObject({ totals: { newFans: 20, duplicateFans: 3, orders: 2 }, matureNewFans: 20, rates: { orderRate: null } });
    expect(result.memberRows.find((row) => row.userId === ids.admin)).toBeUndefined();
    expect(result.groupRows.find((row) => row.groupId === ids.groupC)).toMatchObject({ activePeople: 0, averageOrders: null, sampleState: "INSUFFICIENT" });
  });

  it("keeps a lead inside their own group and refuses a forged selected member", async () => {
    const lead = await loadTeamPerformance(scope("LEAD", [ids.groupA], ids.groupA), "2026-08-12");
    expect(new Set(lead.memberRows.map((row) => row.groupId))).toEqual(new Set([ids.groupA]));
    expect(lead.memberRows.find((row) => row.userId === ids.otherMember)).toBeUndefined();

    const forged = await loadTeamPerformance({ ...scope("LEAD", [ids.groupA], ids.groupA), memberId: ids.otherMember }, "2026-08-12");
    expect(forged.selectedMemberDetail).toBeNull();
  });

  it("cuts off each group's events at that group's own local today", async () => {
    const result = await loadTeamPerformance(scope("ADMIN", [ids.groupA, ids.groupB]), "2026-08-12", {
      groupPeriods: {
        [ids.groupA]: { today: "2026-08-12", from: "2026-07-14", to: "2026-08-12" },
        [ids.groupB]: { today: "2026-07-31", from: "2026-07-01", to: "2026-08-12" },
      },
    });

    expect(result.groupRows.find((row) => row.groupId === ids.groupA)?.totals.newFans).toBe(20);
    expect(result.groupRows.find((row) => row.groupId === ids.groupB)?.totals.newFans).toBe(0);
  });
});
