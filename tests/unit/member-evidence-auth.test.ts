import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/member-overview/[memberId]/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "", databaseUrl: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "member-evidence-auth-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  const databaseUrl = `file:${databasePath}`;
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  isolatedDatabase.directory = directory;
  isolatedDatabase.databaseUrl = databaseUrl;
  return { db: new PrismaClient({ datasourceUrl: databaseUrl }) };
});

const suffix = randomUUID();
const ids = {
  groupA: `member-evidence-group-a-${suffix}`,
  groupB: `member-evidence-group-b-${suffix}`,
  channelA: `member-evidence-channel-a-${suffix}`,
  channelB: `member-evidence-channel-b-${suffix}`,
  admin: `member-evidence-admin-${suffix}`,
  leadA: `member-evidence-lead-a-${suffix}`,
  memberA: `member-evidence-member-a-${suffix}`,
  peerA: `member-evidence-peer-a-${suffix}`,
  memberB: `member-evidence-member-b-${suffix}`,
};

const requestFor = (memberId: string) => GET(
  new Request(`http://localhost/api/member-overview/${memberId}`),
  { params: Promise.resolve({ memberId }) },
);

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T04:00:00.000Z"));
  await db.teamGroup.createMany({ data: [
    { id: ids.groupA, name: "证据一组" },
    { id: ids.groupB, name: "证据二组" },
  ] });
  await db.user.createMany({ data: [
    { id: ids.admin, username: ids.admin, name: "证据管理员", role: "ADMIN" },
    { id: ids.leadA, username: ids.leadA, name: "证据组长", role: "LEAD", groupId: ids.groupA, hireDate: "2026-01-01" },
    { id: ids.memberA, username: ids.memberA, name: "证据成员", role: "RECEPTION", groupId: ids.groupA, hireDate: "2026-01-01" },
    { id: ids.peerA, username: ids.peerA, name: "证据同事", role: "RECEPTION", groupId: ids.groupA, hireDate: "2026-01-01" },
    { id: ids.memberB, username: ids.memberB, name: "越权成员", role: "RECEPTION", groupId: ids.groupB, hireDate: "2026-01-01" },
  ] });
  await db.channel.createMany({ data: [
    { id: ids.channelA, groupId: ids.groupA, name: "证据渠道", normalizedName: "证据渠道", effectiveFanPriceCents: 100 },
    { id: ids.channelB, groupId: ids.groupB, name: "其他渠道", normalizedName: "其他渠道", effectiveFanPriceCents: 200 },
  ] });

  for (let day = 1; day <= 7; day += 1) {
    const sourceDate = `2026-08-${String(day).padStart(2, "0")}`;
    const orderDate = `2026-08-${String(day + 7).padStart(2, "0")}`;
    const batch = await db.sourceBatch.create({
      data: { groupId: ids.groupA, channelId: ids.channelA, sourceDate, fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: 100 },
    });
    await db.metricEvent.createMany({ data: [
      { batchId: batch.id, enteredById: ids.memberA, occurredOn: sourceDate, kind: "NEW_FANS", quantity: 20 },
      { batchId: batch.id, enteredById: ids.memberA, occurredOn: sourceDate, kind: "EFFECTIVE_FANS", quantity: 20 },
      { batchId: batch.id, enteredById: ids.memberA, occurredOn: sourceDate, kind: "RECHARGE", amountCents: 10_000 },
      { batchId: batch.id, enteredById: ids.memberA, occurredOn: orderDate, kind: "ORDER", quantity: 1 },
      { batchId: batch.id, enteredById: ids.peerA, occurredOn: sourceDate, kind: "NEW_FANS", quantity: 20 },
      { batchId: batch.id, enteredById: ids.peerA, occurredOn: sourceDate, kind: "EFFECTIVE_FANS", quantity: 20 },
      { batchId: batch.id, enteredById: ids.peerA, occurredOn: orderDate, kind: "ORDER", quantity: 4 },
    ] });
  }
  await db.dailyEntryConfirmation.createMany({
    data: Array.from({ length: 7 }, (_, index) => ({
      userId: ids.memberA,
      businessDate: `2026-08-${String(index + 8).padStart(2, "0")}`,
    })),
  });
  await db.riskDecision.create({
    data: {
      memberId: ids.memberA,
      actorId: ids.admin,
      level: "LIMIT_WATCH",
      evidenceThrough: "2026-08-14",
      reason: "持续偏低需要人工复核",
    },
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe.sequential("member evidence detail authorization", () => {
  it("runs against its own migrated temporary database", () => {
    expect(isolatedDatabase.databaseUrl).toMatch(/^file:.+\/member-evidence-auth-[^/]+\/test\.db$/);
    expect(isolatedDatabase.databaseUrl).not.toBe(process.env.DATABASE_URL);
  });

  it("lets an administrator read reception evidence but not treat a lead as a receiving member", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.admin } }));

    expect((await requestFor(ids.leadA)).status).toBe(403);
    expect((await requestFor(ids.memberA)).status).toBe(200);
  });

  it("lets a lead read reception users in the same group", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.leadA } }));

    expect((await requestFor(ids.leadA)).status).toBe(403);
    expect((await requestFor(ids.memberA)).status).toBe(200);
  });

  it("returns raw, explainable evidence rather than presentation-formatted strings", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.admin } }));

    const response = await requestFor(ids.memberA);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      member: { id: ids.memberA, group: { id: ids.groupA }, stage: "FORMAL" },
      funnel: { newFans: 140, effectiveFans: 140, orders: 7, rechargeCents: 70_000 },
      channels: [expect.objectContaining({
        channel: expect.objectContaining({ id: ids.channelA }),
        effectiveFanPriceCents: 100,
        financials: expect.objectContaining({ costCents: 14_000, netPerformanceCents: 70_000, profitCents: 56_000, priceState: "PRICED" }),
      })],
      financialFormula: { effectiveFans: 140, effectiveFanPriceCents: 100, costCents: 14_000 },
      trend: { current: expect.any(Object), previous: expect.any(Object) },
      largestDrop: { from: expect.any(String), to: expect.any(String), lost: expect.any(Number) },
      risks: { performance: expect.any(Object), financial: expect.any(Array), data: expect.any(Array) },
      matureBatches: expect.arrayContaining([expect.objectContaining({ sourceDate: "2026-08-01", maturity: "MATURE" })]),
      latestDecision: { level: "LIMIT_WATCH", evidenceThrough: "2026-08-14", reason: "持续偏低需要人工复核" },
    });
    expect(typeof body.funnel.rechargeCents).toBe("number");
    expect(typeof body.channels[0].financials.profitCents).toBe("number");
    expect(body.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ evaluationDate: "2026-08-11", eligible: false, state: "OBSERVING", reason: "INSUFFICIENT_SAMPLE" }),
      expect.objectContaining({ evaluationDate: "2026-08-12", eligible: true, efficiency: 0.25, state: "LOW", reason: "READY" }),
      expect.objectContaining({ evaluationDate: "2026-08-14", eligible: true, efficiency: 0.25, state: "LOW", reason: "READY" }),
    ]));
    expect(body.risks.performance).toMatchObject({ level: "NONE", lowDays: { coaching: 3, limit: 3, elimination: 3 } });
  });

  it("uses configured employee-stage days when selecting formal channel peers", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.admin } }));
    await db.systemSetting.upsert({
      where: { key: "risk.observationDays" },
      update: { value: "1000" },
      create: { key: "risk.observationDays", value: "1000" },
    });
    try {
      const response = await requestFor(ids.memberA);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.evaluations.at(-1)).toMatchObject({
        evaluationDate: "2026-08-14",
        eligible: false,
        state: "OBSERVING",
        reason: "INSUFFICIENT_SAMPLE",
      });
    } finally {
      await db.systemSetting.delete({ where: { key: "risk.observationDays" } });
    }
  });

  it("does not draw financial conclusions from an unconfirmed evaluation day", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.admin } }));
    const batch = await db.sourceBatch.findUniqueOrThrow({
      where: { groupId_channelId_sourceDate: { groupId: ids.groupA, channelId: ids.channelA, sourceDate: "2026-08-07" } },
    });
    const withdrawal = await db.metricEvent.create({
      data: { batchId: batch.id, enteredById: ids.memberA, occurredOn: "2026-08-14", kind: "WITHDRAWAL", amountCents: 100_000 },
    });
    await db.dailyEntryConfirmation.delete({
      where: { userId_businessDate: { userId: ids.memberA, businessDate: "2026-08-14" } },
    });
    try {
      const response = await requestFor(ids.memberA);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.risks.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: "DATA", code: "UNCONFIRMED" }),
      ]));
      expect(body.risks.financial).toEqual([]);
    } finally {
      await db.metricEvent.delete({ where: { id: withdrawal.id } });
      await db.dailyEntryConfirmation.create({ data: { userId: ids.memberA, businessDate: "2026-08-14" } });
    }
  });

  it("denies members even when they request their own evidence", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.memberA } }));

    expect((await requestFor(ids.memberA)).status).toBe(403);
  });

  it("uses the same denial for a lead's cross-group and nonexistent targets", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.leadA } }));

    const crossGroup = await requestFor(ids.memberB);
    const missing = await requestFor(`missing-${suffix}`);

    expect(crossGroup.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(await crossGroup.json()).toEqual(await missing.json());
  });
});
