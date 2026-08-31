import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnalysisScope } from "../../src/lib/analytics/types";
import { createAnalyticsTestDatabase } from "./helpers/analytics-db";

const temporaryDatabase = await createAnalyticsTestDatabase("anomaly-ranking-query");
const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  groupA: `anomaly-group-a-${suffix}`,
  groupB: `anomaly-group-b-${suffix}`,
  strong: `anomaly-strong-${suffix}`,
  weak: `anomaly-weak-${suffix}`,
  zero: `anomaly-zero-${suffix}`,
  solo: `anomaly-solo-${suffix}`,
  insufficient: `anomaly-insufficient-${suffix}`,
  inactive: `anomaly-inactive-${suffix}`,
  otherGroup: `anomaly-other-group-${suffix}`,
  transfer: `anomaly-transfer-${suffix}`,
};

let db: any;
let loadAnomalyRanking: typeof import("../../src/lib/analytics/anomaly-ranking").loadAnomalyRanking;

const scope = (overrides: Partial<AnalysisScope> = {}): AnalysisScope => ({
  actorId: "admin",
  role: "ADMIN",
  groupIds: [ids.groupA, ids.groupB],
  requestedForbiddenGroup: false,
  sourceDateFrom: "2026-07-14",
  sourceDateTo: "2026-08-12",
  includeInactive: false,
  showInsufficient: false,
  ...overrides,
});

async function addBatch(input: {
  groupId: string;
  channelId: string;
  sourceDate: string;
  memberId: string;
  values: Partial<Record<"NEW_FANS" | "EFFECTIVE_FANS" | "REPLIES" | "GROUP_JOIN" | "GROUP_LEAVE" | "ABNORMAL_GROUP_LEAVE" | "EXPERT_INTRO" | "REGISTRATION" | "ORDER", number>>;
  occurredOn?: string;
}) {
  const batch = await db.sourceBatch.findFirst({ where: { groupId: input.groupId, channelId: input.channelId, sourceDate: input.sourceDate } })
    ?? await db.sourceBatch.create({ data: { groupId: input.groupId, channelId: input.channelId, sourceDate: input.sourceDate } });
  const values = {
    ...input.values,
    // These fixtures model ordinary valid leads. In production the import
    // workflow writes EFFECTIVE_FANS separately; keep that fact explicit in
    // the legacy-event fixture so funnel denominators are realistic.
    ...(input.values.NEW_FANS !== undefined && input.values.EFFECTIVE_FANS === undefined
      ? { EFFECTIVE_FANS: input.values.NEW_FANS }
      : {}),
  };
  const rows = Object.entries(values).filter(([, quantity]) => quantity !== undefined).map(([kind, quantity]) => ({
    batchId: batch.id,
    enteredById: input.memberId,
    occurredOn: input.occurredOn ?? input.sourceDate,
    kind,
    quantity,
  }));
  if (rows.length > 0) await db.metricEvent.createMany({ data: rows });
  return batch;
}

beforeAll(async () => {
  process.env.DATABASE_URL = temporaryDatabase.databaseUrl;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  ({ loadAnomalyRanking } = await import("../../src/lib/analytics/anomaly-ranking"));

  await db.teamGroup.createMany({ data: [
    { id: ids.groupA, name: "一组" },
    { id: ids.groupB, name: "二组" },
  ] });
  await db.user.createMany({ data: [
    { id: ids.strong, username: ids.strong, name: "强组员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA },
    { id: ids.weak, username: ids.weak, name: "弱组员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA },
    { id: ids.zero, username: ids.zero, name: "零分母", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA },
    { id: ids.solo, username: ids.solo, name: "单人渠道", passwordHash: "test", role: "LEAD", groupId: ids.groupA },
    { id: ids.insufficient, username: ids.insufficient, name: "样本不足", passwordHash: "test", role: "RECEPTION", groupId: ids.groupA },
    { id: ids.inactive, username: ids.inactive, name: "离职人员", passwordHash: "test", role: "RECEPTION", active: false, groupId: ids.groupA },
    { id: ids.otherGroup, username: ids.otherGroup, name: "二组成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupB },
    { id: ids.transfer, username: ids.transfer, name: "转组成员", passwordHash: "test", role: "RECEPTION", groupId: ids.groupB },
  ] });
  await db.channel.createMany({ data: [
    { id: `shared-a-${suffix}`, name: " 抖音直播 ", normalizedName: "抖音直播", groupId: ids.groupA },
    { id: `shared-b-${suffix}`, name: "抖音直播", normalizedName: "抖音直播", groupId: ids.groupB },
    { id: `zero-${suffix}`, name: "零分母渠道", normalizedName: "零分母渠道", groupId: ids.groupA },
    { id: `solo-${suffix}`, name: "单人渠道", normalizedName: "单人渠道", groupId: ids.groupA },
    { id: `small-${suffix}`, name: "小样本", normalizedName: "小样本", groupId: ids.groupA },
    { id: `inactive-${suffix}`, name: "历史渠道", normalizedName: "历史渠道", groupId: ids.groupA },
    { id: `transfer-a-${suffix}`, name: "转组渠道", normalizedName: "转组渠道", groupId: ids.groupA },
    { id: `transfer-b-${suffix}`, name: "转组渠道", normalizedName: "转组渠道", groupId: ids.groupB },
  ] });

  await addBatch({ groupId: ids.groupA, channelId: `shared-a-${suffix}`, sourceDate: "2026-08-01", memberId: ids.strong, values: { NEW_FANS: 80, REPLIES: 56, GROUP_JOIN: 40, EXPERT_INTRO: 20, REGISTRATION: 10, ORDER: 8 } });
  const weakBatch = await addBatch({ groupId: ids.groupA, channelId: `shared-a-${suffix}`, sourceDate: "2026-08-02", memberId: ids.weak, values: { NEW_FANS: 20, REPLIES: 4, GROUP_JOIN: 4, EXPERT_INTRO: 1, REGISTRATION: 0, ORDER: 0 } });
  await db.metricEvent.create({ data: { batchId: weakBatch.id, enteredById: ids.weak, occurredOn: "2026-08-10", kind: "ORDER", quantity: 9 } });
  await addBatch({ groupId: ids.groupB, channelId: `shared-b-${suffix}`, sourceDate: "2026-08-01", memberId: ids.otherGroup, values: { NEW_FANS: 20, REPLIES: 10, GROUP_JOIN: 10, EXPERT_INTRO: 5, REGISTRATION: 2, ORDER: 1 } });

  await addBatch({ groupId: ids.groupA, channelId: `zero-${suffix}`, sourceDate: "2026-08-01", memberId: ids.strong, values: { NEW_FANS: 20, GROUP_JOIN: 10, EXPERT_INTRO: 5, REGISTRATION: 2, ORDER: 2 } });
  await addBatch({ groupId: ids.groupA, channelId: `zero-${suffix}`, sourceDate: "2026-08-01", memberId: ids.zero, values: { NEW_FANS: 20, GROUP_JOIN: 0, EXPERT_INTRO: 0, REGISTRATION: 0, ORDER: 0 } });
  await addBatch({ groupId: ids.groupA, channelId: `solo-${suffix}`, sourceDate: "2026-08-01", memberId: ids.solo, values: { NEW_FANS: 20, REPLIES: 5, GROUP_JOIN: 4, EXPERT_INTRO: 2, REGISTRATION: 1, ORDER: 1 } });
  await addBatch({ groupId: ids.groupA, channelId: `small-${suffix}`, sourceDate: "2026-08-01", memberId: ids.insufficient, values: { NEW_FANS: 10, REPLIES: 1 } });
  await addBatch({ groupId: ids.groupA, channelId: `inactive-${suffix}`, sourceDate: "2026-08-01", memberId: ids.strong, values: { NEW_FANS: 20, REPLIES: 18 } });
  await addBatch({ groupId: ids.groupA, channelId: `inactive-${suffix}`, sourceDate: "2026-08-01", memberId: ids.inactive, values: { NEW_FANS: 20, REPLIES: 2 } });

  await addBatch({ groupId: ids.groupA, channelId: `shared-a-${suffix}`, sourceDate: "2026-08-10", memberId: ids.weak, values: { NEW_FANS: 100, REPLIES: 0 } });
  await addBatch({ groupId: ids.groupA, channelId: `transfer-a-${suffix}`, sourceDate: "2026-08-01", memberId: ids.transfer, values: { NEW_FANS: 20, REPLIES: 18 } });
  await addBatch({ groupId: ids.groupB, channelId: `transfer-b-${suffix}`, sourceDate: "2026-08-01", memberId: ids.transfer, values: { NEW_FANS: 20, REPLIES: 2 } });
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await temporaryDatabase.cleanup();
});

describe("member anomaly ranking query", () => {
  it("uses weighted channel averages and the five unified funnel formulas", async () => {
    const result = await loadAnomalyRanking(scope({ groupIds: [ids.groupA], groupId: ids.groupA }), "2026-08-12");
    const weak = result.rows.find((row) => row.memberId === ids.weak && row.normalizedName === "抖音直播");

    expect(weak?.newFans).toBe(20);
    expect(weak?.metrics.replyRate).toMatchObject({ value: 0.2, average: 0.6, status: "LOW" });
    expect(weak?.metrics.replyRate.gap).toBeCloseTo(-0.4);
    expect(weak?.metrics.groupRate).toMatchObject({ value: 0.2, average: 44 / 100, status: "LOW" });
    expect(weak?.metrics.groupRate.gap).toBeCloseTo(-0.24);
    expect(weak?.metrics.leaveRate.average).toBe(0);
    expect(weak?.metrics.registrationRate.average).toBeCloseTo(10 / 21);
    expect(weak?.metrics.orderRate).toMatchObject({ value: null, average: 0.8, gap: null, status: "UNAVAILABLE" });
    expect(weak?.anomalyCount).toBe(3);
    expect(result.summary).toMatchObject({ anomalousMemberCount: 2, affectedChannelCount: 2 });
  });

  it("ignores immature batches and events after D7, and does not flag unavailable denominators", async () => {
    const result = await loadAnomalyRanking(scope({ groupIds: [ids.groupA], groupId: ids.groupA }), "2026-08-12");
    const weak = result.rows.find((row) => row.memberId === ids.weak && row.normalizedName === "抖音直播");

    expect(weak?.newFans).toBe(20);
    expect(weak?.metrics.orderRate.value).toBe(null);
    // 统一口径下，进群率以有效数据为分母，因此有效数据不为零的零进群行应被识别。
    expect(result.rows.some((row) => row.memberId === ids.zero)).toBe(true);
    expect(result.rows.some((row) => row.memberId === ids.solo)).toBe(false);
  });

  it("keeps insufficient and inactive people out by default and includes them only when requested", async () => {
    const defaultResult = await loadAnomalyRanking(scope({ groupIds: [ids.groupA], groupId: ids.groupA }), "2026-08-12");
    expect(defaultResult.rows.some((row) => row.memberId === ids.insufficient)).toBe(false);
    expect(defaultResult.rows.some((row) => row.memberId === ids.inactive)).toBe(false);

    const expanded = await loadAnomalyRanking(scope({ groupIds: [ids.groupA], groupId: ids.groupA, includeInactive: true, showInsufficient: true }), "2026-08-12", { showInsufficient: true });
    expect(expanded.rows.find((row) => row.memberId === ids.insufficient)?.rankable).toBe(false);
    expect(expanded.rows.find((row) => row.memberId === ids.inactive)?.memberActive).toBe(false);
  });

  it("merges normalized channels for an admin but keeps a lead inside its own group", async () => {
    const admin = await loadAnomalyRanking(scope({ normalizedName: " 抖音直播 " }), "2026-08-12");
    const adminWeak = admin.rows.find((row) => row.memberId === ids.weak);
    expect(adminWeak?.metrics.replyRate.average).toBeCloseTo(70 / 120);
    expect(admin.channelOptions).toContainEqual({ normalizedName: "抖音直播", name: "抖音直播" });

    const lead = await loadAnomalyRanking(scope({ actorId: ids.solo, role: "LEAD", groupIds: [ids.groupA], groupId: ids.groupA }), "2026-08-12");
    expect(lead.rows.every((row) => row.groupId === ids.groupA)).toBe(true);
    expect(lead.rows.some((row) => row.memberId === ids.otherGroup)).toBe(false);
  });

  it("keeps a transferred member's historical group rows separate", async () => {
    const result = await loadAnomalyRanking(scope({ normalizedName: "转组渠道" }), "2026-08-12");
    const historicalLow = result.rows.find((row) => row.memberId === ids.transfer);

    expect(historicalLow).toMatchObject({ groupId: ids.groupB, groupName: "二组", normalizedName: "转组渠道" });
    expect(historicalLow?.metrics.replyRate).toMatchObject({ value: 0.1, average: 0.5, status: "LOW" });
  });
});
