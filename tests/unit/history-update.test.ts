import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { PATCH } from "../../src/app/api/history/route";
import { db } from "../../src/lib/db";
import { groupHistoryEvents, type HistoryGroup } from "../../src/lib/history-groups";
import { calculateBatchTotals } from "../../src/lib/metrics";

const databaseFixturePrefix = "history-grouped-editing-task2-";
const isolatedDatabase = vi.hoisted(() => ({
  directory: "",
  beforeTransactionCallback: null as null | ((transaction: unknown) => Promise<void>),
}));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "history-grouped-editing-task2-"));
  const databasePath = join(directory, "test.db");
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  const client = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  const db = new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return async (operation: unknown, ...options: unknown[]) => {
          if (typeof operation !== "function") {
            return (target.$transaction as (...args: unknown[]) => Promise<unknown>)(operation, ...options);
          }
          return (target.$transaction as (...args: unknown[]) => Promise<unknown>)(async (transaction: unknown) => {
            await isolatedDatabase.beforeTransactionCallback?.(transaction);
            return (operation as (client: unknown) => Promise<unknown>)(transaction);
          }, ...options);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db };
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;
let fixture: Fixture;

async function removeFixture(prefix: string) {
  await db.auditLog.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await db.metricEvent.deleteMany({ where: { enteredById: { startsWith: prefix } } });
  await db.dailyEntryConfirmation.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.sourceBatch.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.session.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
}

async function createFixture() {
  const prefix = `${databaseFixturePrefix}${randomUUID()}-`;
  const ids = {
    group: `${prefix}group`,
    otherGroup: `${prefix}other-group`,
    inactiveGroup: `${prefix}inactive-group`,
    channel: `${prefix}channel`,
    migrationChannel: `${prefix}migration-channel`,
    inactiveChannel: `${prefix}inactive-channel`,
    otherChannel: `${prefix}other-channel`,
    inactiveGroupChannel: `${prefix}inactive-group-channel`,
    actor: `${prefix}actor`,
    otherActor: `${prefix}other-actor`,
    inactiveActor: `${prefix}inactive-actor`,
    lead: `${prefix}lead`,
    admin: `${prefix}admin`,
    originalBatch: `${prefix}original-batch`,
    targetBatch: `${prefix}target-batch`,
    migrationBatch: `${prefix}migration-batch`,
    collisionBatch: `${prefix}collision-batch`,
    inactiveBatch: `${prefix}inactive-batch`,
    crossGroupBatch: `${prefix}cross-group-batch`,
    inactiveGroupBatch: `${prefix}inactive-group-batch`,
    adminOriginalBatch: `${prefix}admin-original-batch`,
  };

  await db.teamGroup.createMany({ data: [
    { id: ids.group, name: "历史编辑小组" },
    { id: ids.otherGroup, name: "其他小组" },
    { id: ids.inactiveGroup, name: "停用小组", active: false },
  ] });
  await db.channel.createMany({ data: [
    { id: ids.channel, groupId: ids.group, name: "启用渠道", normalizedName: "启用渠道" },
    { id: ids.migrationChannel, groupId: ids.group, name: "迁移渠道", normalizedName: "迁移渠道" },
    { id: ids.inactiveChannel, groupId: ids.group, name: "停用渠道", normalizedName: "停用渠道", active: false },
    { id: ids.otherChannel, groupId: ids.otherGroup, name: "跨组渠道", normalizedName: "跨组渠道" },
    { id: ids.inactiveGroupChannel, groupId: ids.inactiveGroup, name: "停用组渠道", normalizedName: "停用组渠道" },
  ] });
  await db.user.createMany({ data: [
    { id: ids.actor, username: ids.actor, name: "本人", passwordHash: `${prefix}do-not-audit`, role: "RECEPTION", groupId: ids.group },
    { id: ids.otherActor, username: ids.otherActor, name: "其他成员", passwordHash: "hash", role: "RECEPTION", groupId: ids.group },
    { id: ids.inactiveActor, username: ids.inactiveActor, name: "停用成员", passwordHash: "hash", role: "RECEPTION", groupId: ids.group, active: false },
    { id: ids.lead, username: ids.lead, name: "组长", passwordHash: "hash", role: "LEAD", groupId: ids.group },
    { id: ids.admin, username: ids.admin, name: "管理员", passwordHash: "hash", role: "ADMIN" },
  ] });
  await db.sourceBatch.createMany({ data: [
    { id: ids.originalBatch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-01" },
    { id: ids.targetBatch, groupId: ids.group, channelId: ids.migrationChannel, sourceDate: "2026-08-02" },
    { id: ids.migrationBatch, groupId: ids.group, channelId: ids.migrationChannel, sourceDate: "2026-08-07" },
    { id: ids.collisionBatch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-03" },
    { id: ids.inactiveBatch, groupId: ids.group, channelId: ids.inactiveChannel, sourceDate: "2026-08-04" },
    { id: ids.crossGroupBatch, groupId: ids.otherGroup, channelId: ids.otherChannel, sourceDate: "2026-08-05" },
    { id: ids.inactiveGroupBatch, groupId: ids.inactiveGroup, channelId: ids.inactiveGroupChannel, sourceDate: "2026-08-05" },
    { id: ids.adminOriginalBatch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-06" },
  ] });

  await db.metricEvent.createMany({ data: [
    {
      id: `${prefix}reply-first`, batchId: ids.originalBatch, enteredById: ids.actor,
      occurredOn: "2026-08-10", kind: "REPLIES", quantity: 2, createdAt: new Date("2026-08-10T00:00:01.000Z"),
    },
    {
      id: `${prefix}reply-second`, batchId: ids.originalBatch, enteredById: ids.actor,
      occurredOn: "2026-08-10", kind: "REPLIES", quantity: 3, createdAt: new Date("2026-08-10T00:00:02.000Z"),
    },
    {
      id: `${prefix}leave`, batchId: ids.originalBatch, enteredById: ids.actor,
      occurredOn: "2026-08-10", kind: "GROUP_LEAVE", quantity: 6, createdAt: new Date("2026-08-10T00:00:03.000Z"),
    },
    {
      id: `${prefix}recharge`, batchId: ids.originalBatch, enteredById: ids.actor,
      occurredOn: "2026-08-10", kind: "RECHARGE", amountCents: 1_250, createdAt: new Date("2026-08-10T00:00:04.000Z"),
    },
    {
      id: `${prefix}other-owner-event`, batchId: ids.originalBatch, enteredById: ids.otherActor,
      occurredOn: "2026-08-11", kind: "REPLIES", quantity: 9,
    },
    {
      id: `${prefix}inactive-owner-event`, batchId: ids.originalBatch, enteredById: ids.inactiveActor,
      occurredOn: "2026-08-12", kind: "REPLIES", quantity: 8,
    },
    {
      id: `${prefix}collision-event`, batchId: ids.collisionBatch, enteredById: ids.actor,
      occurredOn: "2026-08-20", kind: "ORDER", quantity: 1,
    },
    {
      id: `${prefix}admin-event`, batchId: ids.adminOriginalBatch, enteredById: ids.admin,
      occurredOn: "2026-08-15", kind: "NEW_FANS", quantity: 1,
    },
    {
      id: `${prefix}ledger-derived`, batchId: ids.originalBatch, enteredById: ids.actor,
      occurredOn: "2026-08-13", kind: "NEW_FANS", quantity: 1, derivedFromLedger: true,
    },
  ] });

  return { prefix, ids };
}

async function readGroup(enteredById: string, occurredOn: string, batchId: string): Promise<HistoryGroup> {
  const events = await db.metricEvent.findMany({
    where: { enteredById, occurredOn, batchId },
    select: {
      id: true,
      occurredOn: true,
      kind: true,
      quantity: true,
      amountCents: true,
      batch: {
        select: {
          id: true,
          sourceDate: true,
          group: { select: { id: true, name: true, active: true } },
          channel: { select: { id: true, name: true, active: true } },
        },
      },
      enteredBy: { select: { id: true, name: true, active: true } },
    },
  });
  const [group] = groupHistoryEvents(events);
  if (!group) throw new Error("Fixture history group was not created");
  return group;
}

function updateRequest(group: HistoryGroup, overrides: {
  batchId?: string;
  occurredOn?: string;
  fingerprint?: string;
  metrics?: Partial<HistoryGroup["metrics"]>;
  eventIds?: string[];
} = {}) {
  return new Request("http://localhost/api/history", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventIds: overrides.eventIds ?? group.eventIds,
      fingerprint: overrides.fingerprint ?? group.fingerprint,
      occurredOn: overrides.occurredOn ?? group.occurredOn,
      batchId: overrides.batchId ?? group.batchId,
      metrics: { ...group.metrics, ...overrides.metrics },
    }),
  });
}

async function databaseState(prefix: string) {
  const [events, audits] = await Promise.all([
    db.metricEvent.findMany({
      where: { enteredById: { startsWith: prefix } },
      orderBy: { id: "asc" },
      select: { id: true, batchId: true, enteredById: true, occurredOn: true, kind: true, quantity: true, amountCents: true },
    }),
    db.auditLog.findMany({
      where: { actorId: { startsWith: prefix } },
      orderBy: { id: "asc" },
      select: { actorId: true, action: true, entityType: true, entityId: true, summary: true },
    }),
  ]);
  return { events, audits };
}

async function expectRejectedWithoutWrites(
  request: Request,
  status: number,
  expectedBody?: Record<string, unknown>,
) {
  const before = await databaseState(fixture.prefix);
  const response = await PATCH(request);
  expect(response.status).toBe(status);
  if (expectedBody) expect(await response.json()).toEqual(expectedBody);
  expect(await databaseState(fixture.prefix)).toEqual(before);
}

beforeEach(async () => {
  // History moves below use dates through August 23. Freeze the business day
  // so the test verifies edit permissions/collisions rather than being tied
  // to the developer's calendar date.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
  fixture = await createFixture();
});

afterEach(async () => {
  isolatedDatabase.beforeTransactionCallback = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (fixture?.prefix) await removeFixture(fixture.prefix);
});

afterAll(async () => {
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe.sequential("PATCH /api/history", () => {
  it("rejects edits to compatibility rows owned by the phone-level customer ledger", async () => {
    const group = await readGroup(fixture.ids.actor, "2026-08-13", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    await expectRejectedWithoutWrites(updateRequest(group, { metrics: { newFans: 2 } }), 409, {
      error: "这组数据来自手机号客户账本，请到对应客户记录中修改",
    });
  });

  it("allows only an active actor to edit one complete group they own", async () => {
    const ownGroup = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const otherGroup = await readGroup(fixture.ids.otherActor, "2026-08-11", fixture.ids.originalBatch);
    const inactiveGroup = await readGroup(fixture.ids.inactiveActor, "2026-08-12", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    const inactiveActor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.inactiveActor } });
    const lead = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.lead } });
    const admin = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.admin } });

    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const ownResponse = await PATCH(updateRequest(ownGroup, { metrics: { replies: 4 } }));
    expect(ownResponse.status).toBe(200);
    expect((await ownResponse.json()).group.metrics.replies).toBe(4);

    vi.mocked(auth.requireUser).mockResolvedValue(actor);
    await expectRejectedWithoutWrites(updateRequest(otherGroup, { metrics: { replies: 1 } }), 403, {
      error: "无权修改该记录",
    });
    vi.mocked(auth.requireUser).mockResolvedValue(admin);
    await expectRejectedWithoutWrites(updateRequest(otherGroup, { metrics: { replies: 1 } }), 403, {
      error: "无权修改该记录",
    });
    vi.mocked(auth.requireUser).mockResolvedValue(lead);
    await expectRejectedWithoutWrites(updateRequest(otherGroup, { metrics: { replies: 1 } }), 403, {
      error: "无权修改该记录",
    });
    vi.mocked(auth.requireUser).mockResolvedValue(actor);
    await expectRejectedWithoutWrites(updateRequest(ownGroup, {
      eventIds: [ownGroup.eventIds[0], otherGroup.eventIds[0]],
    }), 403, { error: "无权修改该记录" });
    await expectRejectedWithoutWrites(updateRequest(ownGroup, {
      eventIds: [`${fixture.prefix}missing-event`],
    }), 403, { error: "无权修改该记录" });

    vi.mocked(auth.requireUser).mockResolvedValue(inactiveActor);
    await expectRejectedWithoutWrites(updateRequest(inactiveGroup, { metrics: { replies: 1 } }), 403, {
      error: "无权修改该记录",
    });
  });

  it("replaces owned fan-quality and financial totals, refreshes the fingerprint, and audits before/after values", async () => {
    await db.metricEvent.createMany({ data: [
      {
        id: `${fixture.prefix}effective-existing`, batchId: fixture.ids.originalBatch, enteredById: fixture.ids.actor,
        occurredOn: "2026-08-10", kind: "EFFECTIVE_FANS", quantity: 2,
      },
      {
        id: `${fixture.prefix}withdrawal-existing`, batchId: fixture.ids.originalBatch, enteredById: fixture.ids.actor,
        occurredOn: "2026-08-10", kind: "WITHDRAWAL", amountCents: 100,
      },
      {
        id: `${fixture.prefix}performance-existing`, batchId: fixture.ids.originalBatch, enteredById: fixture.ids.actor,
        occurredOn: "2026-08-10", kind: "CHANNEL_PERFORMANCE", amountCents: 200,
      },
    ] });
    const oldGroup = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const response = await PATCH(updateRequest(oldGroup, { metrics: {
      newFans: 10,
      effectiveFans: 6,
      noNumber: 1,
      duplicateFans: 2,
      withdrawalCents: 500,
      channelPerformanceCents: 3_000,
    } }));

    expect(response.status).toBe(200);
    const updatedGroup = (await response.json()).group as HistoryGroup;
    expect(updatedGroup.metrics).toMatchObject({
      newFans: 10,
      effectiveFans: 6,
      noNumber: 1,
      duplicateFans: 2,
      withdrawalCents: 500,
      channelPerformanceCents: 3_000,
    });
    expect(updatedGroup.fingerprint).not.toBe(oldGroup.fingerprint);

    const replaced = await db.metricEvent.findMany({
      where: { id: { in: [
        `${fixture.prefix}effective-existing`,
        `${fixture.prefix}withdrawal-existing`,
        `${fixture.prefix}performance-existing`,
      ] } },
      orderBy: { kind: "asc" },
      select: { id: true, kind: true, quantity: true, amountCents: true },
    });
    expect(replaced).toEqual([
      { id: `${fixture.prefix}performance-existing`, kind: "CHANNEL_PERFORMANCE", quantity: null, amountCents: 3_000 },
      { id: `${fixture.prefix}effective-existing`, kind: "EFFECTIVE_FANS", quantity: 6, amountCents: null },
      { id: `${fixture.prefix}withdrawal-existing`, kind: "WITHDRAWAL", quantity: null, amountCents: 500 },
    ]);
    expect(await db.metricEvent.count({
      where: {
        enteredById: fixture.ids.actor,
        batchId: fixture.ids.originalBatch,
        occurredOn: "2026-08-10",
        kind: { in: ["EFFECTIVE_FANS", "WITHDRAWAL", "CHANNEL_PERFORMANCE"] },
      },
    })).toBe(3);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { actorId: fixture.ids.actor, action: "HISTORY_GROUP_UPDATED" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.parse(audit.summary).metrics).toMatchObject({
      effectiveFans: { from: 2, to: 6 },
      noNumber: { from: 0, to: 1 },
      duplicateFans: { from: 0, to: 2 },
      withdrawalCents: { from: 100, to: 500 },
      channelPerformanceCents: { from: 200, to: 3_000 },
    });
  });

  it("rejects a fan-quality breakdown above total fans without writing any row or audit", async () => {
    const group = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    await expectRejectedWithoutWrites(updateRequest(group, { metrics: {
      newFans: 100,
      effectiveFans: 81,
      noNumber: 10,
      duplicateFans: 10,
    } }), 400, {
      error: "请检查填写内容",
      fields: {
        "metrics.effectiveFans": ["有效粉、无 WS 号码和撞粉合计不能大于提交号码"],
      },
    });
  });

  it("preserves confirmation time and touches its audit timestamp when confirmed history is edited", async () => {
    const ownGroup = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    const originalTime = new Date("2026-08-10T01:00:00.000Z");
    await db.dailyEntryConfirmation.create({
      data: { userId: actor.id, businessDate: "2026-08-10", confirmedAt: originalTime, updatedAt: originalTime },
    });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const response = await PATCH(updateRequest(ownGroup, { metrics: { replies: 4 } }));

    expect(response.status).toBe(200);
    const confirmation = await db.dailyEntryConfirmation.findUniqueOrThrow({
      where: { userId_businessDate: { userId: actor.id, businessDate: "2026-08-10" } },
    });
    expect(confirmation.confirmedAt).toEqual(originalTime);
    expect(confirmation.updatedAt.getTime()).toBeGreaterThan(originalTime.getTime());
  });

  it("rejects inactive and out-of-scope target batches without changing any row", async () => {
    const group = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expectRejectedWithoutWrites(updateRequest(group, { batchId: fixture.ids.crossGroupBatch }), 403, {
      error: "无权修改该记录",
    });
    const scopeEvent = JSON.parse(String(info.mock.calls.at(-1)?.[0]));
    expect(Object.keys(scopeEvent).sort()).toEqual(["category", "event", "result", "teamId", "timestamp", "userId"]);
    expect(scopeEvent).toMatchObject({
      event: "AUTHORIZATION_DENIED",
      userId: fixture.ids.actor,
      teamId: fixture.ids.group,
      result: "denied",
    });
    info.mockRestore();
    await expectRejectedWithoutWrites(updateRequest(group, { batchId: fixture.ids.inactiveBatch }), 400);
    await expectRejectedWithoutWrites(updateRequest(group, { batchId: fixture.ids.inactiveGroupBatch }), 400);
  });

  it("rejects stale and colliding moves without partial writes or audit logs", async () => {
    const group = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    await expectRejectedWithoutWrites(updateRequest(group, {
      fingerprint: "0".repeat(64),
      metrics: { replies: 4 },
    }), 409, { error: "这组数据已被更新，请刷新后再修改" });

    await db.metricEvent.create({ data: {
      id: `${fixture.prefix}concurrent-zero-event`,
      batchId: fixture.ids.originalBatch,
      enteredById: fixture.ids.actor,
      occurredOn: "2026-08-10",
      kind: "ORDER",
      quantity: 0,
    } });
    await expectRejectedWithoutWrites(updateRequest(group, { metrics: { replies: 4 } }), 409, {
      error: "这组数据已被更新，请刷新后再修改",
    });

    const currentGroup = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);

    await expectRejectedWithoutWrites(updateRequest(currentGroup, {
      batchId: fixture.ids.collisionBatch,
      occurredOn: "2026-08-20",
    }), 409, { error: "目标日期和来源批次已有记录，请打开已有记录修改" });
  });

  it("allows value corrections and migration from an inactive original source but rejects moving its date in place", async () => {
    const group = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    await db.channel.update({
      where: { id_groupId: { id: fixture.ids.channel, groupId: fixture.ids.group } },
      data: { active: false },
    });
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const valueResponse = await PATCH(updateRequest(group, { metrics: { replies: 4 } }));
    expect(valueResponse.status).toBe(200);
    const updatedGroup = (await valueResponse.json()).group as HistoryGroup;
    expect(updatedGroup.metrics.replies).toBe(4);
    expect(updatedGroup.batch.channel.active).toBe(false);

    await expectRejectedWithoutWrites(updateRequest(updatedGroup, { occurredOn: "2026-08-19" }), 400);

    const migrationResponse = await PATCH(updateRequest(updatedGroup, {
      batchId: fixture.ids.migrationBatch,
      occurredOn: "2026-08-19",
    }));
    expect(migrationResponse.status).toBe(200);
    expect((await migrationResponse.json()).group).toMatchObject({
      batchId: fixture.ids.migrationBatch,
      occurredOn: "2026-08-19",
      metrics: { replies: 4 },
    });
  });

  it("normalizes all metrics, moves every old row, audits safe changes, and updates report totals", async () => {
    const oldGroup = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const response = await PATCH(updateRequest(oldGroup, {
      batchId: fixture.ids.targetBatch,
      occurredOn: "2026-08-21",
      metrics: {
        newFans: 7,
        replies: 4,
        groupJoin: 2,
        groupLeave: 0,
        expertIntro: 3,
        registration: 4,
        order: 5,
        rechargeCents: 2_500,
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      group: {
        key: `${fixture.ids.actor}::2026-08-21::${fixture.ids.targetBatch}`,
        occurredOn: "2026-08-21",
        batchId: fixture.ids.targetBatch,
        metrics: {
          newFans: 7,
          replies: 4,
          groupJoin: 2,
          groupLeave: 0,
          expertIntro: 3,
          registration: 4,
          order: 5,
          rechargeCents: 2_500,
        },
      },
    });

    const movedEvents = await db.metricEvent.findMany({
      where: { id: { in: oldGroup.eventIds } },
      orderBy: { createdAt: "asc" },
    });
    expect(movedEvents).toHaveLength(4);
    expect(movedEvents.every((event) => event.batchId === fixture.ids.targetBatch && event.occurredOn === "2026-08-21")).toBe(true);
    expect(movedEvents.filter((event) => event.kind === "REPLIES").map((event) => event.quantity)).toEqual([4, 0]);
    expect(movedEvents.filter((event) => event.kind === "REPLIES").every((event) => event.amountCents === null)).toBe(true);

    const zeroedLeave = movedEvents.find((event) => event.kind === "GROUP_LEAVE");
    expect(zeroedLeave).toMatchObject({ quantity: 0, amountCents: null });
    const recharge = movedEvents.find((event) => event.kind === "RECHARGE");
    expect(recharge).toMatchObject({ quantity: null, amountCents: 2_500 });

    const normalizedEvents = await db.metricEvent.findMany({
      where: {
        enteredById: fixture.ids.actor,
        batchId: fixture.ids.targetBatch,
        occurredOn: "2026-08-21",
      },
      orderBy: [{ kind: "asc" }, { createdAt: "asc" }],
    });
    expect(normalizedEvents.map(({ kind, quantity, amountCents }) => ({ kind, quantity, amountCents }))).toEqual([
      { kind: "EXPERT_INTRO", quantity: 3, amountCents: null },
      { kind: "GROUP_JOIN", quantity: 2, amountCents: null },
      { kind: "GROUP_LEAVE", quantity: 0, amountCents: null },
      { kind: "NEW_FANS", quantity: 7, amountCents: null },
      { kind: "ORDER", quantity: 5, amountCents: null },
      { kind: "RECHARGE", quantity: null, amountCents: 2_500 },
      { kind: "REGISTRATION", quantity: 4, amountCents: null },
      { kind: "REPLIES", quantity: 4, amountCents: null },
      { kind: "REPLIES", quantity: 0, amountCents: null },
    ]);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { actorId: fixture.ids.actor, action: "HISTORY_GROUP_UPDATED" },
    });
    expect(audit).toMatchObject({
      entityType: "HistoryGroup",
      entityId: oldGroup.key,
    });
    expect(JSON.parse(audit.summary)).toEqual({
      batchId: { from: fixture.ids.originalBatch, to: fixture.ids.targetBatch },
      metrics: {
        expertIntro: { from: 0, to: 3 },
        groupJoin: { from: 0, to: 2 },
        groupLeave: { from: 6, to: 0 },
        newFans: { from: 0, to: 7 },
        order: { from: 0, to: 5 },
        rechargeCents: { from: 1_250, to: 2_500 },
        registration: { from: 0, to: 4 },
        replies: { from: 5, to: 4 },
      },
      occurredOn: { from: "2026-08-10", to: "2026-08-21" },
    });
    expect(audit.summary).not.toContain(`${fixture.prefix}do-not-audit`);
    expect(audit.summary).not.toContain(oldGroup.fingerprint);
    for (const eventId of oldGroup.eventIds) expect(audit.summary).not.toContain(eventId);

    const reportEvents = await db.metricEvent.findMany({
      where: { enteredById: fixture.ids.actor, batchId: fixture.ids.targetBatch, occurredOn: "2026-08-21" },
      select: { kind: true, quantity: true, amountCents: true },
    });
    expect(calculateBatchTotals(reportEvents)).toMatchObject({
      newFans: 7,
      replies: 4,
      groupJoin: 2,
      groupLeave: 0,
      expertIntro: 3,
      registration: 4,
      orders: 5,
      rechargeCents: 2_500,
    });
  });

  it("rechecks actor, target state, and destination collision inside the PATCH transaction", async () => {
    const group = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    isolatedDatabase.beforeTransactionCallback = async (transaction) => {
      const tx = transaction as typeof db;
      await tx.user.update({ where: { id: fixture.ids.actor }, data: { active: false } });
    };
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const inactiveActorResponse = await PATCH(updateRequest(group, { metrics: { replies: 4 } }));
    expect(inactiveActorResponse.status).toBe(403);
    expect(await inactiveActorResponse.json()).toEqual({ error: "无权修改该记录" });
    const recheckEvent = JSON.parse(String(info.mock.calls.at(-1)?.[0]));
    expect(Object.keys(recheckEvent).sort()).toEqual(["category", "event", "result", "teamId", "timestamp", "userId"]);
    expect(recheckEvent).toMatchObject({
      event: "AUTHORIZATION_DENIED",
      userId: fixture.ids.actor,
      teamId: fixture.ids.group,
      result: "denied",
    });
    info.mockRestore();

    await db.user.update({ where: { id: fixture.ids.actor }, data: { active: true } });
    isolatedDatabase.beforeTransactionCallback = async (transaction) => {
      const tx = transaction as typeof db;
      await tx.channel.update({
        where: { id_groupId: { id: fixture.ids.migrationChannel, groupId: fixture.ids.group } },
        data: { active: false },
      });
    };
    const inactiveTargetResponse = await PATCH(updateRequest(group, { batchId: fixture.ids.targetBatch }));
    expect(inactiveTargetResponse.status).toBe(400);

    await db.channel.update({
      where: { id_groupId: { id: fixture.ids.migrationChannel, groupId: fixture.ids.group } },
      data: { active: true },
    });
    isolatedDatabase.beforeTransactionCallback = async (transaction) => {
      const tx = transaction as typeof db;
      await tx.metricEvent.create({ data: {
        id: `${fixture.prefix}timed-collision`,
        batchId: fixture.ids.targetBatch,
        enteredById: fixture.ids.actor,
        occurredOn: "2026-08-23",
        kind: "ORDER",
        quantity: 1,
      } });
    };
    const collisionResponse = await PATCH(updateRequest(group, {
      batchId: fixture.ids.targetBatch,
      occurredOn: "2026-08-23",
    }));
    expect(collisionResponse.status).toBe(409);
    expect(await collisionResponse.json()).toEqual({
      error: "目标日期和来源批次已有记录，请打开已有记录修改",
    });
  });

  it("rolls back metric changes when the audit write fails", async () => {
    const group = await readGroup(fixture.ids.actor, "2026-08-10", fixture.ids.originalBatch);
    const actor = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.actor } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const before = await databaseState(fixture.prefix);
    const triggerName = `fail_history_audit_${randomUUID().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "AuditLog"
      WHEN NEW."actorId" = '${fixture.ids.actor}'
      BEGIN
        SELECT RAISE(ABORT, 'forced audit failure');
      END
    `);
    try {
      await expect(PATCH(updateRequest(group, { metrics: { replies: 4, groupJoin: 2 } })))
        .rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}"`);
    }
    expect(await databaseState(fixture.prefix)).toEqual(before);
  });

  it("rejects an administrator editing historical business data", async () => {
    const group = await readGroup(fixture.ids.admin, "2026-08-15", fixture.ids.adminOriginalBatch);
    const admin = await db.user.findUniqueOrThrow({ where: { id: fixture.ids.admin } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(admin);

    const response = await PATCH(updateRequest(group, {
      batchId: fixture.ids.crossGroupBatch,
      occurredOn: "2026-08-22",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "无权修改该记录" });
  });
});
