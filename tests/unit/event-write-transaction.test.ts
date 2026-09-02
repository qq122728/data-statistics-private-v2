import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST as postBatches } from "../../src/app/api/batches/route";
import { POST as postEvents } from "../../src/app/api/events/route";
import { GET as getCustomerOrders, POST as postCustomerOrders } from "../../src/app/api/customer-orders/route";
import { POST as postCustomerFinance } from "../../src/app/api/customer-finance/route";
import { autoMarkExpiredGroupMemberships, automaticLeaveCutoff } from "../../src/lib/group-lifecycle";

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
  const directory = mkdtempSync(join(tmpdir(), "member-entry-transaction-"));
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
  return {
    db,
    getOrCreateSourceBatch: (
      key: { groupId: string; channelId: string; sourceDate: string },
      transaction: typeof client = db,
    ) => transaction.sourceBatch.upsert({
      where: { groupId_channelId_sourceDate: key },
      update: {},
      create: key,
    }),
  };
});

type Role = "RECEPTION" | "LEAD" | "ADMIN";

async function createFixture(role: Role = "RECEPTION") {
  const suffix = randomUUID();
  const groupId = `event-group-${suffix}`;
  const channelId = `event-channel-${suffix}`;
  const userId = `event-user-${suffix}`;
  const otherUserId = `event-other-${suffix}`;
  await db.teamGroup.create({ data: { id: groupId, name: `事件事务小组 ${suffix}` } });
  await db.channel.create({ data: { id: channelId, groupId, name: `事件事务渠道 ${suffix}`, normalizedName: `事件事务渠道 ${suffix}` } });
  await db.user.createMany({ data: [
    { id: userId, username: userId, name: "当前录入人", role, groupId: role === "ADMIN" ? null : groupId },
    { id: otherUserId, username: otherUserId, name: "其他成员", role: "RECEPTION", groupId },
  ] });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  vi.spyOn(auth, "requireUser").mockResolvedValue(user);
  return { groupId, channelId, userId, otherUserId, user };
}

function newFansBody(fixture: Awaited<ReturnType<typeof createFixture>>, overrides: Record<string, unknown> = {}) {
  return {
    channelId: fixture.channelId,
    ...(fixture.user.role === "ADMIN" ? { groupId: fixture.groupId } : {}),
    sourceDate: "2026-08-11",
    quantity: 100,
    effectiveFans: 80,
    noNumber: 10,
    duplicateFans: 5,
    ...overrides,
  };
}

afterEach(() => {
  isolatedDatabase.beforeTransactionCallback = null;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe.sequential("member entry write transactions", () => {
  it("keeps day 14 in group and automatically marks day 15 as a system leave", async () => {
    const fixture = await createFixture("LEAD");
    const batch = await db.sourceBatch.create({ data: { groupId: fixture.groupId, channelId: fixture.channelId, sourceDate: "2026-08-01" } });
    const [day15, day14, archived] = await Promise.all([
      db.leadCustomer.create({ data: { phone: `auto-left-${fixture.userId}`, batchId: batch.id, ownerId: fixture.userId, groupStatus: "JOINED", joinedOn: "2026-08-12", isHistoricalRecord: true } }),
      db.leadCustomer.create({ data: { phone: `stay-group-${fixture.userId}`, batchId: batch.id, ownerId: fixture.userId, groupStatus: "JOINED", joinedOn: "2026-08-13" } }),
      db.leadCustomer.create({ data: { phone: `archived-stay-${fixture.userId}`, batchId: batch.id, ownerId: fixture.userId, groupStatus: "JOINED", joinedOn: "2026-08-01", trackingArchivedAt: new Date("2026-09-01T00:00:00.000Z") } }),
    ]);
    await db.customerOrder.create({ data: { phone: day15.phone, batchId: batch.id, enteredById: fixture.userId, leadId: day15.id, openedOn: "2026-08-20", initialDepositCents: 10_000, initialDepositMethod: "CRYPTO" } });

    expect(automaticLeaveCutoff("2026-08-26")).toBe("2026-08-12");
    await expect(autoMarkExpiredGroupMemberships({ today: "2026-08-26", groupIds: [fixture.groupId] })).resolves.toEqual({ checkedThrough: "2026-08-12", updated: 1 });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: day15.id } })).resolves.toMatchObject({ groupStatus: "LEFT", leftOn: "2026-08-26", leftAutomatically: true, leftWithOrder: true, historicalLeaveCounted: true });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: day14.id } })).resolves.toMatchObject({ groupStatus: "JOINED", leftOn: null, leftAutomatically: false });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: archived.id } })).resolves.toMatchObject({ groupStatus: "JOINED", leftOn: null, leftAutomatically: false });
  });

  it("calculates effective fans from received minus invalid fans", async () => {
    const fixture = await createFixture();
    const response = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify({ channelId: fixture.channelId, sourceDate: "2026-08-14", quantity: 20, invalidFans: 3 }),
    }));
    expect(response.status).toBe(201);
    const batch = (await response.json()).batches[0];
    expect(await db.metricEvent.findMany({ where: { batchId: batch.id }, orderBy: { kind: "asc" }, select: { kind: true, quantity: true } })).toEqual([
      { kind: "DUPLICATE_FANS", quantity: 0 },
      { kind: "EFFECTIVE_FANS", quantity: 17 },
      { kind: "NEW_FANS", quantity: 20 },
      { kind: "NO_NUMBER", quantity: 3 },
    ]);
  });
  it("writes all four fan-quality events in one batch for the signed-in member", async () => {
    const fixture = await createFixture();

    const response = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansBody(fixture, { enteredById: fixture.otherUserId })),
    }));

    expect(response.status).toBe(201);
    const batch = (await response.json()).batches[0];
    const events = await db.metricEvent.findMany({
      where: { batchId: batch.id },
      orderBy: { kind: "asc" },
      select: { enteredById: true, kind: true, quantity: true },
    });
    expect(events.map((event) => [event.kind, event.quantity])).toEqual([
      ["DUPLICATE_FANS", 5],
      ["EFFECTIVE_FANS", 80],
      ["NEW_FANS", 100],
      ["NO_NUMBER", 10],
    ]);
    expect(new Set(events.map((event) => event.enteredById))).toEqual(new Set([fixture.userId]));
  });

  it("persists all four fan-quality events when every value is zero", async () => {
    const fixture = await createFixture();

    const response = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansBody(fixture, {
        quantity: 0,
        effectiveFans: 0,
        noNumber: 0,
        duplicateFans: 0,
      })),
    }));

    expect(response.status).toBe(201);
    const batch = (await response.json()).batches[0];
    expect(await db.metricEvent.findMany({
      where: { batchId: batch.id },
      orderBy: { kind: "asc" },
      select: { kind: true, quantity: true },
    })).toEqual([
      { kind: "DUPLICATE_FANS", quantity: 0 },
      { kind: "EFFECTIVE_FANS", quantity: 0 },
      { kind: "NEW_FANS", quantity: 0 },
      { kind: "NO_NUMBER", quantity: 0 },
    ]);
  });

  it.each([
    ["a breakdown total greater than new fans", { quantity: 100, effectiveFans: 81, noNumber: 10, duplicateFans: 10 }],
    ["a negative fan value", { effectiveFans: -1 }],
    ["a value above Prisma Int", { quantity: 2_147_483_648 }],
  ])("rejects %s without creating a batch or event", async (_label, overrides) => {
    const fixture = await createFixture();
    const before = {
      batches: await db.sourceBatch.count({ where: { channelId: fixture.channelId, groupId: fixture.groupId } }),
      events: await db.metricEvent.count({ where: { enteredById: fixture.userId } }),
    };

    const response = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansBody(fixture, overrides)),
    }));

    expect(response.status).toBe(400);
    expect({
      batches: await db.sourceBatch.count({ where: { channelId: fixture.channelId, groupId: fixture.groupId } }),
      events: await db.metricEvent.count({ where: { enteredById: fixture.userId } }),
    }).toEqual(before);
  });

  it("does not write a valid sibling row when another fan row is invalid", async () => {
    const fixture = await createFixture();

    const response = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify({ batches: [
        newFansBody(fixture),
        newFansBody(fixture, { sourceDate: "2026-08-12", effectiveFans: 101 }),
      ] }),
    }));

    expect(response.status).toBe(400);
    expect(await db.metricEvent.count({ where: { enteredById: fixture.userId } })).toBe(0);
    expect(await db.sourceBatch.count({ where: { channelId: fixture.channelId, groupId: fixture.groupId } })).toBe(0);
  });

  it("pins forged batch and amount-event ownership to the signed-in reception", async () => {
    const fixture = await createFixture("RECEPTION");
    const batchResponse = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansBody(fixture, { enteredById: fixture.otherUserId })),
    }));
    const batch = (await batchResponse.json()).batches[0];

    const eventResponse = await postEvents(new Request("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({
        batchId: batch.id,
        occurredOn: "2026-08-12",
        kind: "WITHDRAWAL",
        amountCents: 500,
        enteredById: fixture.otherUserId,
      }),
    }));

    expect(batchResponse.status).toBe(201);
    expect(eventResponse.status).toBe(201);
    expect(await db.metricEvent.count({ where: { batchId: batch.id, enteredById: fixture.otherUserId } })).toBe(0);
    expect(await db.metricEvent.count({ where: { batchId: batch.id, enteredById: fixture.userId } })).toBe(5);
  });

  it.each(["WITHDRAWAL", "CHANNEL_PERFORMANCE"] as const)("accepts %s amount events and rejects invalid amount shapes", async (kind) => {
    const fixture = await createFixture();
    const batch = await db.sourceBatch.create({ data: {
      groupId: fixture.groupId,
      channelId: fixture.channelId,
      sourceDate: "2026-08-11",
    } });

    const valid = await postEvents(new Request("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({ batchId: batch.id, occurredOn: "2026-08-12", kind, amountCents: 0 }),
    }));
    expect(valid.status).toBe(201);

    for (const invalidBody of [
      { batchId: batch.id, occurredOn: "2026-08-12", kind, amountCents: -1 },
      { batchId: batch.id, occurredOn: "2026-08-12", kind, amountCents: 100, quantity: 1 },
    ]) {
      const invalid = await postEvents(new Request("http://localhost/api/events", {
        method: "POST",
        body: JSON.stringify(invalidBody),
      }));
      expect(invalid.status).toBe(400);
    }
    expect(await db.metricEvent.count({ where: { batchId: batch.id, kind } })).toBe(1);
  });

  it("rechecks the current user inside the amount-event write transaction", async () => {
    const fixture = await createFixture();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const batch = await db.sourceBatch.create({ data: {
      groupId: fixture.groupId,
      channelId: fixture.channelId,
      sourceDate: "2026-08-11",
    } });
    isolatedDatabase.beforeTransactionCallback = async (transaction) => {
      const tx = transaction as typeof db;
      await tx.user.update({ where: { id: fixture.userId }, data: { active: false } });
    };

    const response = await postEvents(new Request("http://localhost/api/events", {
      method: "POST",
      body: JSON.stringify({ batchId: batch.id, occurredOn: "2026-08-11", kind: "CHANNEL_PERFORMANCE", amountCents: 1 }),
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("X-Security-Audit")).toBe("app");
    expect((await response.json()).fields["rows.0.batchId"]).toEqual(["没有权限写入该来源批次"]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      event: "AUTHORIZATION_DENIED",
      userId: fixture.userId,
      teamId: fixture.groupId,
      result: "denied",
    });
    expect(await db.metricEvent.count({ where: { batchId: batch.id } })).toBe(0);
  });

  it("links a leave to the original join and rejects leaving more than remains", async () => {
    const fixture = await createFixture();
    const batch = await db.sourceBatch.create({ data: { groupId: fixture.groupId, channelId: fixture.channelId, sourceDate: "2026-08-12" } });
    const joined = await postEvents(new Request("http://localhost/api/events", { method: "POST", body: JSON.stringify({ batchId: batch.id, occurredOn: "2026-08-13", kind: "GROUP_JOIN", quantity: 4 }) }));
    const joinEvent = (await joined.json()).events[0];
    const left = await postEvents(new Request("http://localhost/api/events", { method: "POST", body: JSON.stringify({ batchId: batch.id, occurredOn: "2026-08-14", kind: "GROUP_LEAVE", quantity: 3, parentEventId: joinEvent.id }) }));
    expect(left.status).toBe(201);
    expect((await left.json()).events[0].parentEventId).toBe(joinEvent.id);
    const tooMany = await postEvents(new Request("http://localhost/api/events", { method: "POST", body: JSON.stringify({ batchId: batch.id, occurredOn: "2026-08-14", kind: "GROUP_LEAVE", quantity: 2, parentEventId: joinEvent.id }) }));
    expect(tooMany.status).toBe(400);
    expect(await db.metricEvent.aggregate({ where: { parentEventId: joinEvent.id }, _sum: { quantity: true } })).toEqual({ _sum: { quantity: 3 } });
  });

  it("creates one opening per customer identifier and records numbered continuation and withdrawal ledgers", async () => {
    const fixture = await createFixture("LEAD");
    const batch = await db.sourceBatch.create({ data: { groupId: fixture.groupId, channelId: fixture.channelId, sourceDate: "2026-08-12" } });
    const lead = await db.leadCustomer.create({ data: {
      phone: "233911", batchId: batch.id, ownerId: fixture.userId,
      groupStatus: "JOINED", joinedOn: "2026-08-12",
      expertIntroducedOn: "2026-08-12", registeredOn: "2026-08-12",
    } });
    const opened = await postCustomerOrders(new Request("http://localhost/api/customer-orders", { method: "POST", body: JSON.stringify({ leadId: lead.id, batchId: batch.id, openedOn: "2026-08-13", phone: "TL-DG-FB-Q-233911", initialDepositCents: 50_000, initialDepositMethod: "BANK" }) }));
    expect(opened.status).toBe(201);
    const order = (await opened.json()).orders[0];
    expect(order.phone).toBe("233911");
    expect(await db.metricEvent.findMany({ where: { customerOrderId: order.id } })).toEqual([]);
    expect(await db.customerFinanceEvent.findMany({ where: { customerOrderId: order.id }, select: { kind: true, amountCents: true, continuationNumber: true } })).toEqual([
      { kind: "RECHARGE", amountCents: 50_000, continuationNumber: null },
    ]);

    const finance = await postCustomerFinance(new Request("http://localhost/api/customer-finance", { method: "POST", body: JSON.stringify({ rows: [
      { customerOrderId: order.id, occurredOn: "2026-08-14", kind: "RECHARGE", amountCents: 20_000, continuationNumber: 1, depositMethod: "CRYPTO" },
      { customerOrderId: order.id, occurredOn: "2026-08-14", kind: "WITHDRAWAL", amountCents: 5_000 },
    ] }) }));
    expect(finance.status).toBe(201);
    const duplicate = await postCustomerFinance(new Request("http://localhost/api/customer-finance", { method: "POST", body: JSON.stringify({ customerOrderId: order.id, occurredOn: "2026-08-14", kind: "RECHARGE", amountCents: 1, continuationNumber: 1, depositMethod: "BANK" }) }));
    expect(duplicate.status).toBe(400);
    expect(await db.metricEvent.findMany({ where: { customerOrderId: order.id } })).toEqual([]);
    expect(await db.customerFinanceEvent.count({ where: { customerOrderId: order.id, voidedAt: null } })).toBe(3);
    expect((await getCustomerOrders()).status).toBe(200);
    expect((await (await getCustomerOrders()).json()).orders.map((item: { id: string }) => item.id)).toContain(order.id);
  });
});
