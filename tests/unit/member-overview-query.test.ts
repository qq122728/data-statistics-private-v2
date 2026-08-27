import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnalysisScope } from "../../src/lib/analytics/types";

const execFile = promisify(execFileCallback);
const databaseDirectory = await mkdtemp(join(tmpdir(), "member-overview-query-"));
const databasePath = join(databaseDirectory, "test.db");
const databaseUrl = `file:${databasePath}`;
await writeFile(databasePath, "");
await execFile("npx", ["prisma", "migrate", "deploy"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  groupA: `overview-group-a-${suffix}`,
  groupB: `overview-group-b-${suffix}`,
  channelA: `overview-channel-a-${suffix}`,
  pendingA: `overview-pending-a-${suffix}`,
  invalidA: `overview-invalid-a-${suffix}`,
  channelB: `overview-channel-b-${suffix}`,
  admin: `overview-admin-${suffix}`,
  leadA: `overview-lead-a-${suffix}`,
  memberA: `overview-member-a-${suffix}`,
  peerA: `overview-peer-a-${suffix}`,
  trainingA: `overview-training-a-${suffix}`,
  invalidMemberA: `overview-invalid-member-a-${suffix}`,
  inactiveA: `overview-inactive-a-${suffix}`,
  leadB: `overview-lead-b-${suffix}`,
  memberB: `overview-member-b-${suffix}`,
};

let db: any;
let loadMemberOverview: typeof import("../../src/lib/analytics/member-overview").loadMemberOverview;

const scope = (role: "ADMIN" | "LEAD", groupIds: string[], overrides: Partial<AnalysisScope> = {}): AnalysisScope => ({
  actorId: role === "ADMIN" ? ids.admin : ids.leadA,
  role,
  groupIds,
  groupId: role === "LEAD" ? ids.groupA : undefined,
  requestedForbiddenGroup: false,
  period: "mature30",
  showInsufficient: false,
  sourceDateFrom: "2026-07-16",
  sourceDateTo: "2026-08-14",
  includeInactive: false,
  ...overrides,
});

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  ({ loadMemberOverview } = await import("../../src/lib/analytics/member-overview"));

  await db.teamGroup.createMany({ data: [
    { id: ids.groupA, name: "一组" },
    { id: ids.groupB, name: "二组" },
  ] });
  await db.channel.createMany({ data: [
    { id: ids.channelA, groupId: ids.groupA, name: "共享渠道", normalizedName: "shared", effectiveFanPriceCents: 100 },
    { id: ids.pendingA, groupId: ids.groupA, name: "待定价渠道", normalizedName: "pending", effectiveFanPriceCents: null },
    { id: ids.invalidA, groupId: ids.groupA, name: "异常渠道", normalizedName: "invalid", effectiveFanPriceCents: 100 },
    { id: ids.channelB, groupId: ids.groupB, name: "共享渠道", normalizedName: "shared", effectiveFanPriceCents: 200 },
  ] });
  await db.user.createMany({ data: [
    { id: ids.admin, username: ids.admin, name: "管理员", passwordHash: "test", role: "ADMIN" },
    { id: ids.leadA, username: ids.leadA, name: "A 组长", passwordHash: "test", role: "LEAD", groupId: ids.groupA, hireDate: "2026-01-01" },
    { id: ids.memberA, username: ids.memberA, name: "A 成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA, hireDate: "2026-01-01" },
    { id: ids.peerA, username: ids.peerA, name: "A 同行", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA, hireDate: "2026-01-01" },
    { id: ids.trainingA, username: ids.trainingA, name: "A 培训", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA, hireDate: "2026-08-10" },
    { id: ids.invalidMemberA, username: ids.invalidMemberA, name: "A 异常", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA, hireDate: "2026-01-01" },
    { id: ids.inactiveA, username: ids.inactiveA, name: "A 停用", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA, hireDate: "2026-01-01", active: false },
    { id: ids.leadB, username: ids.leadB, name: "B 组长", passwordHash: "test", role: "LEAD", groupId: ids.groupB, hireDate: "2026-01-01" },
    { id: ids.memberB, username: ids.memberB, name: "B 成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupB, hireDate: "2026-01-01" },
  ] });

  const [currentA, pendingA, invalidA, observingA, previousA, currentB] = await Promise.all([
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-01", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: 100 } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.pendingA, sourceDate: "2026-08-02", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: null } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.invalidA, sourceDate: "2026-08-01", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: 100 } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-10", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: 100 } }),
    db.sourceBatch.create({ data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-07-01", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: 100 } }),
    db.sourceBatch.create({ data: { groupId: ids.groupB, channelId: ids.channelB, sourceDate: "2026-08-01", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: 200 } }),
  ]);

  await db.metricEvent.createMany({ data: [
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 120 },
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-01", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-07", kind: "ORDER", quantity: 10 },
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-07", kind: "RECHARGE", amountCents: 20_000 },
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-07", kind: "WITHDRAWAL", amountCents: 1_000 },
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-07", kind: "CHANNEL_PERFORMANCE", amountCents: 1_000 },
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-09", kind: "ORDER", quantity: 99 },
    { batchId: currentA.id, enteredById: ids.memberA, occurredOn: "2026-08-09", kind: "RECHARGE", amountCents: 999_999 },

    { batchId: currentA.id, enteredById: ids.peerA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 120 },
    { batchId: currentA.id, enteredById: ids.peerA, occurredOn: "2026-08-01", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: currentA.id, enteredById: ids.peerA, occurredOn: "2026-08-07", kind: "ORDER", quantity: 5 },
    { batchId: currentA.id, enteredById: ids.peerA, occurredOn: "2026-08-07", kind: "RECHARGE", amountCents: 12_000 },

    { batchId: pendingA.id, enteredById: ids.trainingA, occurredOn: "2026-08-02", kind: "NEW_FANS", quantity: 100 },
    { batchId: pendingA.id, enteredById: ids.trainingA, occurredOn: "2026-08-02", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: pendingA.id, enteredById: ids.trainingA, occurredOn: "2026-08-08", kind: "ORDER", quantity: 1 },
    { batchId: pendingA.id, enteredById: ids.trainingA, occurredOn: "2026-08-08", kind: "RECHARGE", amountCents: 10_000 },

    { batchId: invalidA.id, enteredById: ids.invalidMemberA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 100 },
    { batchId: invalidA.id, enteredById: ids.invalidMemberA, occurredOn: "2026-08-01", kind: "EFFECTIVE_FANS", quantity: 110 },
    { batchId: invalidA.id, enteredById: ids.invalidMemberA, occurredOn: "2026-08-07", kind: "ORDER", quantity: 1 },

    { batchId: currentA.id, enteredById: ids.inactiveA, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 100 },
    { batchId: currentA.id, enteredById: ids.inactiveA, occurredOn: "2026-08-01", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: currentA.id, enteredById: ids.inactiveA, occurredOn: "2026-08-07", kind: "ORDER", quantity: 100 },

    { batchId: observingA.id, enteredById: ids.memberA, occurredOn: "2026-08-10", kind: "EFFECTIVE_FANS", quantity: 1_000 },
    { batchId: observingA.id, enteredById: ids.memberA, occurredOn: "2026-08-14", kind: "ORDER", quantity: 1_000 },

    { batchId: previousA.id, enteredById: ids.memberA, occurredOn: "2026-07-01", kind: "NEW_FANS", quantity: 100 },
    { batchId: previousA.id, enteredById: ids.memberA, occurredOn: "2026-07-01", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: previousA.id, enteredById: ids.memberA, occurredOn: "2026-07-07", kind: "ORDER", quantity: 5 },
    { batchId: previousA.id, enteredById: ids.peerA, occurredOn: "2026-07-01", kind: "NEW_FANS", quantity: 100 },
    { batchId: previousA.id, enteredById: ids.peerA, occurredOn: "2026-07-01", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: previousA.id, enteredById: ids.peerA, occurredOn: "2026-07-07", kind: "ORDER", quantity: 5 },

    { batchId: currentB.id, enteredById: ids.memberB, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 100 },
    { batchId: currentB.id, enteredById: ids.memberB, occurredOn: "2026-08-01", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: currentB.id, enteredById: ids.memberB, occurredOn: "2026-08-07", kind: "ORDER", quantity: 40 },
    { batchId: currentB.id, enteredById: ids.memberB, occurredOn: "2026-08-07", kind: "RECHARGE", amountCents: 50_000 },
    { batchId: currentB.id, enteredById: ids.leadB, occurredOn: "2026-08-01", kind: "NEW_FANS", quantity: 100 },
    { batchId: currentB.id, enteredById: ids.leadB, occurredOn: "2026-08-01", kind: "EFFECTIVE_FANS", quantity: 100 },
    { batchId: currentB.id, enteredById: ids.leadB, occurredOn: "2026-08-07", kind: "ORDER", quantity: 20 },
    { batchId: currentB.id, enteredById: ids.leadB, occurredOn: "2026-08-07", kind: "RECHARGE", amountCents: 20_000 },
  ] });
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await rm(databaseDirectory, { recursive: true, force: true });
});

describe("member overview aggregation query", () => {
  it("loads all authorized groups for admins and only the assigned group for leads", async () => {
    const admin = await loadMemberOverview(scope("ADMIN", [ids.groupA, ids.groupB]), "2026-08-14");
    const lead = await loadMemberOverview(scope("LEAD", [ids.groupA]), "2026-08-14");

    expect(new Set(admin.rows.map((row) => row.group.id))).toEqual(new Set([ids.groupA, ids.groupB]));
    expect(new Set(lead.rows.map((row) => row.group.id))).toEqual(new Set([ids.groupA]));
    expect(admin.rows.every((row) => row.member.role === "RECEPTION")).toBe(true);
    expect(admin.rows.map((row) => row.member.id)).not.toContain(ids.leadB);
    expect(admin.summary).toMatchObject({ matureBatchCount: 4, observingBatchCount: 1, rankedMemberCount: 2, attentionMemberCount: 1 });
    expect(lead.summary).toMatchObject({ matureBatchCount: 3, observingBatchCount: 1, rankedMemberCount: 2, attentionMemberCount: 1 });
  });

  it("uses only mature D0-D7 evidence and calculates current and previous periods with the same attribution", async () => {
    const result = await loadMemberOverview(scope("LEAD", [ids.groupA]), "2026-08-14");
    const member = result.rows.find((row) => row.member.id === ids.memberA);

    expect(member).toMatchObject({
      group: { id: ids.groupA },
      stage: "FORMAL",
      totals: { newFans: 120, effectiveFans: 100, orders: 10, rechargeCents: 20_000 },
      effectiveRate: 100 / 120,
      // 开单率以“已注册”为分母；这批旧测试事件没有注册记录，因此不显示比例。
      orderRate: null,
      rechargePerEffectiveFanCents: 200,
      financials: { costCents: 10_000, netPerformanceCents: 19_000, profitCents: 9_000, priceState: "PRICED" },
      adjustedEfficiency: 2,
      adjustedState: "READY",
      trend: 1,
      pricingState: "PRICED",
    });
  });

  it("excludes inactive members by default and allows explicit historical inspection", async () => {
    const normal = await loadMemberOverview(scope("LEAD", [ids.groupA]), "2026-08-14");
    const historical = await loadMemberOverview(scope("LEAD", [ids.groupA], { includeInactive: true }), "2026-08-14");

    expect(normal.rows.find((row) => row.member.id === ids.inactiveA)).toBeUndefined();
    expect(historical.rows.find((row) => row.member.id === ids.inactiveA)).toMatchObject({
      member: { active: false },
      totals: { effectiveFans: 100, orders: 100 },
    });
  });

  it("keeps an unpriced historical batch pending after the channel receives a later price", async () => {
    const pending = await loadMemberOverview(scope("LEAD", [ids.groupA]), "2026-08-14");
    expect(pending.rows.find((row) => row.member.id === ids.trainingA)).toMatchObject({
      stage: "TRAINING",
      financials: { costCents: null, netPerformanceCents: 10_000, profitCents: null, priceState: "PENDING_PRICE" },
      pricingState: "PENDING_PRICE",
    });
    expect(pending.summary).toMatchObject({ costCents: null, profitCents: null });
    expect(pending.pendingPriceChannels).toEqual([{ id: ids.pendingA, groupId: ids.groupA, name: "待定价渠道" }]);

    await db.channel.update({
      where: { id_groupId: { id: ids.pendingA, groupId: ids.groupA } },
      data: { effectiveFanPriceCents: 50 },
    });
    const priced = await loadMemberOverview(scope("LEAD", [ids.groupA]), "2026-08-14");
    expect(priced.rows.find((row) => row.member.id === ids.trainingA)).toMatchObject({
      financials: { costCents: null, netPerformanceCents: 10_000, profitCents: null, priceState: "PENDING_PRICE" },
      pricingState: "PENDING_PRICE",
    });
    expect(priced.summary.costCents).toBeNull();
    expect(priced.summary.profitCents).toBeNull();
    expect(priced.pendingPriceChannels).toEqual([{ id: ids.pendingA, groupId: ids.groupA, name: "待定价渠道" }]);
  });

  it("retains invalid business totals but never evaluates or formally ranks them", async () => {
    const result = await loadMemberOverview(scope("LEAD", [ids.groupA]), "2026-08-14");
    const invalid = result.rows.find((row) => row.member.id === ids.invalidMemberA);

    expect(invalid).toMatchObject({
      totals: { newFans: 100, effectiveFans: 110 },
      adjustedEfficiency: null,
      adjustedState: "DATA_INVALID",
    });
    expect(result.rows.slice(0, result.summary.rankedMemberCount).map((row) => row.member.id)).not.toContain(ids.invalidMemberA);
  });

  it("rejects a forged non-management scope instead of querying business data", async () => {
    const forged = { ...scope("LEAD", [ids.groupA]), role: "RECEPTION", actorId: ids.memberA } as unknown as AnalysisScope;
    await expect(loadMemberOverview(forged, "2026-08-14")).rejects.toThrow("管理分析仅限管理员、资源部管理员和组长");
  });
});
