import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnalysisScope } from "../../src/lib/analytics/types";
import { createAnalyticsTestDatabase } from "./helpers/analytics-db";

const temporaryDatabase = await createAnalyticsTestDatabase("analytics-attribution-cross-query");
const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  groupA: `attribution-group-a-${suffix}`,
  groupB: `attribution-group-b-${suffix}`,
  channelA: `attribution-channel-a-${suffix}`,
  leadA: `attribution-lead-a-${suffix}`,
  movedMember: `attribution-moved-member-${suffix}`,
  inactiveMember: `attribution-inactive-member-${suffix}`,
};

let db: any;
let loadManagementOverview: typeof import("../../src/lib/analytics/overview").loadManagementOverview;
let loadTeamPerformance: typeof import("../../src/lib/analytics/team-performance").loadTeamPerformance;
let loadChannelAnalysis: typeof import("../../src/lib/analytics/channel-analysis").loadChannelAnalysis;
let loadBatchTracking: typeof import("../../src/lib/analytics/batch-tracking").loadBatchTracking;

const groupAScope: AnalysisScope = {
  actorId: ids.leadA,
  role: "LEAD",
  groupIds: [ids.groupA],
  groupId: ids.groupA,
  requestedForbiddenGroup: false,
  showInsufficient: false,
  sourceDateFrom: "2026-07-14",
  sourceDateTo: "2026-08-12",
  includeInactive: false,
};

beforeAll(async () => {
  process.env.DATABASE_URL = temporaryDatabase.databaseUrl;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  ({ loadManagementOverview } = await import("../../src/lib/analytics/overview"));
  ({ loadTeamPerformance } = await import("../../src/lib/analytics/team-performance"));
  ({ loadChannelAnalysis } = await import("../../src/lib/analytics/channel-analysis"));
  ({ loadBatchTracking } = await import("../../src/lib/analytics/batch-tracking"));

  await db.teamGroup.createMany({ data: [{ id: ids.groupA, name: "历史 A 组" }, { id: ids.groupB, name: "当前 B 组" }] });
  await db.channel.create({ data: { id: ids.channelA, name: "历史渠道", normalizedName: "历史渠道", groupId: ids.groupA } });
  await db.user.createMany({ data: [
    { id: ids.leadA, username: ids.leadA, name: "A 组长", passwordHash: "test", role: "LEAD", groupId: ids.groupA },
    { id: ids.movedMember, username: ids.movedMember, name: "已调组成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupB },
    { id: ids.inactiveMember, username: ids.inactiveMember, name: "已停用成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA, active: false },
  ] });
  const batch = await db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-01" } });
  await db.metricEvent.createMany({ data: [
    { batchId: batch.id, enteredById: ids.movedMember, occurredOn: "2026-08-06", kind: "NEW_FANS", quantity: 25 },
    { batchId: batch.id, enteredById: ids.movedMember, occurredOn: "2026-08-08", kind: "GROUP_JOIN", quantity: 10 },
    { batchId: batch.id, enteredById: ids.inactiveMember, occurredOn: "2026-08-06", kind: "NEW_FANS", quantity: 15 },
    { batchId: batch.id, enteredById: ids.inactiveMember, occurredOn: "2026-08-08", kind: "GROUP_JOIN", quantity: 6 },
  ] });
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await temporaryDatabase.cleanup();
});

describe("historical performance attribution across management analysis", () => {
  it("keeps moved and inactive members' historical totals stable across all four queries", async () => {
    const [overview, team, channel, batch, overviewWithInactive, teamWithInactive, channelWithInactive, batchWithInactive] = await Promise.all([
      loadManagementOverview(groupAScope, "2026-08-12"),
      loadTeamPerformance(groupAScope, "2026-08-12"),
      loadChannelAnalysis(groupAScope, "2026-08-12"),
      loadBatchTracking(groupAScope, "2026-08-12"),
      loadManagementOverview({ ...groupAScope, includeInactive: true }, "2026-08-12"),
      loadTeamPerformance({ ...groupAScope, includeInactive: true }, "2026-08-12"),
      loadChannelAnalysis({ ...groupAScope, includeInactive: true }, "2026-08-12"),
      loadBatchTracking({ ...groupAScope, includeInactive: true }, "2026-08-12"),
    ]);

    expect(overview.summary.newFans).toBe(40);
    expect(overviewWithInactive.summary.newFans).toBe(40);
    expect(team.memberRows).toContainEqual(expect.objectContaining({ userId: ids.movedMember, groupId: ids.groupA, groupName: "历史 A 组", totals: expect.objectContaining({ newFans: 25 }) }));
    expect(team.memberRows.find((row) => row.userId === ids.inactiveMember)).toBeUndefined();
    expect(teamWithInactive.memberRows).toContainEqual(expect.objectContaining({ userId: ids.inactiveMember, active: false, totals: expect.objectContaining({ newFans: 15 }) }));
    expect(team.groupRows.find((row) => row.groupId === ids.groupA)?.totals.newFans).toBe(40);
    expect(teamWithInactive.groupRows.find((row) => row.groupId === ids.groupA)?.totals.newFans).toBe(40);
    expect(channel.rows.find((row) => row.normalizedName === "历史渠道")?.newFans).toBe(40);
    expect(channelWithInactive.rows.find((row) => row.normalizedName === "历史渠道")?.newFans).toBe(40);
    expect(batch.rows).toContainEqual(expect.objectContaining({ memberId: ids.movedMember, groupId: ids.groupA, groupName: "历史 A 组", totals: expect.objectContaining({ newFans: 25 }) }));
    expect(batch.rows.reduce((sum, row) => sum + row.totals.newFans, 0)).toBe(40);
    expect(batchWithInactive.rows.reduce((sum, row) => sum + row.totals.newFans, 0)).toBe(40);
  });
});
