import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnalysisScope } from "../../src/lib/analytics/types";
import { createAnalyticsTestDatabase } from "./helpers/analytics-db";

const temporaryDatabase = await createAnalyticsTestDatabase("batch-tracking-query");
const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  groupA: `batch-group-a-${suffix}`,
  groupB: `batch-group-b-${suffix}`,
  channelA: `batch-channel-a-${suffix}`,
  channelB: `batch-channel-b-${suffix}`,
  leadA: `batch-lead-a-${suffix}`,
  memberA: `batch-member-a-${suffix}`,
  admin: `batch-admin-${suffix}`,
  inactiveMember: `batch-inactive-member-${suffix}`,
  otherMember: `batch-other-member-${suffix}`,
};

let db: any;
let loadBatchTracking: typeof import("../../src/lib/analytics/batch-tracking").loadBatchTracking;
let loadBatchDetail: typeof import("../../src/lib/analytics/batch-tracking").loadBatchDetail;
let sharedBatchId = "";

const scope = (role: "ADMIN" | "LEAD", groupIds: string[], overrides: Partial<AnalysisScope> = {}): AnalysisScope => ({
  actorId: ids.leadA,
  role,
  groupIds,
  requestedForbiddenGroup: false,
  showInsufficient: false,
  sourceDateFrom: "2026-07-29",
  sourceDateTo: "2026-08-12",
  includeInactive: false,
  ...overrides,
});

beforeAll(async () => {
  process.env.DATABASE_URL = temporaryDatabase.databaseUrl;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  ({ loadBatchTracking, loadBatchDetail } = await import("../../src/lib/analytics/batch-tracking"));
  await db.teamGroup.createMany({ data: [{ id: ids.groupA, name: "一组" }, { id: ids.groupB, name: "二组" }] });
  await db.channel.createMany({ data: [
    { id: ids.channelA, name: "抖音", normalizedName: "抖音", groupId: ids.groupA },
    { id: ids.channelB, name: "视频号", normalizedName: "视频号", groupId: ids.groupB },
  ] });
  await db.user.createMany({ data: [
    { id: ids.leadA, username: ids.leadA, name: "组长 A", passwordHash: "test", role: "LEAD", groupId: ids.groupA },
    { id: ids.memberA, username: ids.memberA, name: "成员 A", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA },
    { id: ids.admin, username: ids.admin, name: "管理员录入人", passwordHash: "test", role: "ADMIN" },
    { id: ids.inactiveMember, username: ids.inactiveMember, name: "停用成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA, active: false },
    { id: ids.otherMember, username: ids.otherMember, name: "其他组成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupB },
  ] });
  const [shared, d0, d4to7, stalled, other] = await Promise.all([
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-01", channelTypeSnapshot: "ADS", advertisingFanCount: 20, advertisingSpendCents: 10_000, advertisingServiceFeeRateBps: 1_500, effectiveFanPriceCentsSnapshot: 575 } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-12" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-05" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-04" } }),
    db.sourceBatch.create({ data: { groupId: ids.groupB, channelId: ids.channelB, sourceDate: "2026-08-01" } }),
  ]);
  sharedBatchId = shared.id;
  await db.metricEvent.createMany({ data: [
    { batchId: shared.id, enteredById: ids.leadA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 25 },
    { batchId: shared.id, enteredById: ids.leadA, occurredOn: "2026-08-06", kind: "GROUP_JOIN", quantity: 10 },
    { batchId: shared.id, enteredById: ids.memberA, occurredOn: "2026-07-31", kind: "ORDER", quantity: 9 },
    { batchId: shared.id, enteredById: ids.memberA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 20 },
    { batchId: shared.id, enteredById: ids.memberA, occurredOn: "2026-08-08", kind: "ORDER", quantity: 2 },
    { batchId: shared.id, enteredById: ids.admin, occurredOn: "2026-08-02", kind: "NEW_FANS", quantity: 99 },
    { batchId: shared.id, enteredById: ids.inactiveMember, occurredOn: "2026-08-02", kind: "NEW_FANS", quantity: 7 },
    { batchId: d0.id, enteredById: ids.memberA, occurredOn: "2026-08-12", kind: "NEW_FANS", quantity: 5 },
    { batchId: d4to7.id, enteredById: ids.memberA, occurredOn: "2026-08-05", kind: "NEW_FANS", quantity: 5 },
    { batchId: stalled.id, enteredById: ids.memberA, occurredOn: "2026-08-04", kind: "NEW_FANS", quantity: 20 },
    { batchId: stalled.id, enteredById: ids.memberA, occurredOn: "2026-08-05", kind: "REPLIES", quantity: 10 },
    { batchId: stalled.id, enteredById: ids.memberA, occurredOn: "2026-08-12", kind: "NEW_FANS", quantity: 1 },
    { batchId: stalled.id, enteredById: ids.memberA, occurredOn: "2026-08-12", kind: "REPLIES", quantity: 0 },
    { batchId: other.id, enteredById: ids.otherMember, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 100 },
  ] });
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await temporaryDatabase.cleanup();
});

describe.sequential("batch tracking query", () => {
  it("splits one source batch by owner, labels ages, and prioritizes stalled rows", async () => {
    const result = await loadBatchTracking(scope("ADMIN", [ids.groupA, ids.groupB]), "2026-08-12");
    const sameBatchRows = result.rows.filter((row) => row.batchId === sharedBatchId);

    expect(sameBatchRows).toHaveLength(2);
    expect(new Set(sameBatchRows.map((row) => row.memberId))).toEqual(new Set([ids.memberA, ids.inactiveMember]));
    expect(result.rows.find((row) => row.sourceDate === "2026-08-12")?.ageLabel).toBe("D0");
    expect(result.rows.find((row) => row.sourceDate === "2026-08-05")?.ageLabel).toBe("D4–7");
    expect(result.rows.find((row) => row.sourceDate === "2026-08-04")?.status).toBe("STALLED");
  });

  it("limits lead rows and requires batch, owner, and readable group for details", async () => {
    const leadScope = scope("LEAD", [ids.groupA], { groupId: ids.groupA });
    const result = await loadBatchTracking(leadScope, "2026-08-12");
    expect(new Set(result.rows.map((row) => row.groupId))).toEqual(new Set([ids.groupA]));
    expect(await loadBatchDetail(leadScope, sharedBatchId, ids.memberA, "2026-08-12")).toMatchObject({ batchId: sharedBatchId, memberId: ids.memberA, channelType: "ADS", advertisingFanCount: 20, advertisingSpendCents: 10_000, effectiveFanPriceCentsSnapshot: 575, d7: { totals: { orders: 2 } }, customers: [] });
    expect(await loadBatchDetail({ ...leadScope, sourceDateFrom: "2026-08-12", sourceDateTo: "2026-08-12", normalizedName: "不存在" }, sharedBatchId, ids.memberA, "2026-08-12")).toMatchObject({ batchId: sharedBatchId, memberId: ids.memberA });
    expect(await loadBatchDetail(leadScope, sharedBatchId, ids.otherMember, "2026-08-12")).toBeNull();
  });

  it("never exposes administrator-owned events and keeps inactive-owner batch history readable", async () => {
    const adminScope = scope("ADMIN", [ids.groupA]);

    expect(await loadBatchDetail(adminScope, sharedBatchId, ids.admin, "2026-08-12")).toBeNull();
    expect(await loadBatchDetail(adminScope, sharedBatchId, ids.inactiveMember, "2026-08-12")).toMatchObject({ batchId: sharedBatchId, memberId: ids.inactiveMember });
    expect(await loadBatchDetail({ ...adminScope, includeInactive: true }, sharedBatchId, ids.inactiveMember, "2026-08-12")).toMatchObject({ batchId: sharedBatchId, memberId: ids.inactiveMember });
  });

  it("adds phone and current owner details when a batch uses the customer ledger", async () => {
    await db.leadCustomer.create({
      data: {
        phone: "13800138001",
        customerName: "批次客户",
        batchId: sharedBatchId,
        ownerId: ids.memberA,
        groupStatus: "NOT_JOINED",
      },
    });
    const detail = await loadBatchDetail(scope("LEAD", [ids.groupA], { groupId: ids.groupA }), sharedBatchId, ids.memberA, "2026-08-12");
    expect(detail?.customers).toEqual([
      expect.objectContaining({ phone: "13800138001", customerName: "批次客户", currentOwner: "成员 A（接粉）" }),
    ]);
  });
});
