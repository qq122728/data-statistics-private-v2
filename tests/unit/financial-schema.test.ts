import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const databaseDirectory = await mkdtemp(join(tmpdir(), "financial-schema-test-"));
const databasePath = join(databaseDirectory, "test.db");
const databaseUrl = `file:${databasePath}`;
let prisma: PrismaClient;

beforeAll(async () => {
  await execFile("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  await prisma.teamGroup.create({ data: { id: "financial-schema-group", name: "财务测试组" } });
  await prisma.user.create({
    data: {
      id: "financial-schema-actor",
      username: "financial-schema-actor",
      name: "测试录入员",
      role: "LEAD",
    },
  });
  await prisma.channel.create({
    data: {
      id: "financial-schema-channel",
      groupId: "financial-schema-group",
      name: "财务测试渠道",
      normalizedName: "财务测试渠道",
    },
  });
  await prisma.sourceBatch.create({
    data: {
      groupId: "financial-schema-group",
      channelId: "financial-schema-channel",
      sourceDate: "2026-08-01",
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  await rm(databaseDirectory, { recursive: true, force: true });
}, 30_000);

describe("financial member schema", () => {
  it("persists the effective fan price and member stage fields", async () => {
    const channel = await prisma.channel.findFirst({
      where: { id: "financial-schema-channel", groupId: "financial-schema-group" },
      select: { effectiveFanPriceCents: true },
    });
    expect(channel).toHaveProperty("effectiveFanPriceCents");

    const member = await prisma.user.create({
      data: {
        id: "financial-schema-member",
        username: "financial-schema-member",
        name: "测试成员",
        role: "RECEPTION",
        hireDate: "2026-08-01",
        stageOverride: "OBSERVATION",
        stageOverrideReason: "延长观察期",
      },
    });
    expect(member.hireDate).toBe("2026-08-01");
    expect(member.stageOverride).toBe("OBSERVATION");
  });

  it("accepts the five new financial metric event kinds", async () => {
    const batch = await prisma.sourceBatch.findUniqueOrThrow({
      where: {
        groupId_channelId_sourceDate: {
          groupId: "financial-schema-group",
          channelId: "financial-schema-channel",
          sourceDate: "2026-08-01",
        },
      },
    });
    const kinds = ["EFFECTIVE_FANS", "NO_NUMBER", "DUPLICATE_FANS", "WITHDRAWAL", "CHANNEL_PERFORMANCE"] as const;

    await Promise.all(kinds.map((kind) => prisma.metricEvent.create({
      data: {
        batchId: batch.id,
        enteredById: "financial-schema-actor",
        occurredOn: "2026-08-01",
        kind,
        quantity: 1,
      },
    })));

    const events = await prisma.metricEvent.findMany({
      where: { batchId: batch.id, kind: { in: [...kinds] } },
      select: { kind: true },
      orderBy: { kind: "asc" },
    });
    expect(events.map((event) => event.kind).sort()).toEqual([...kinds].sort());
  });

  it("links one customer phone to its opening, continuation, withdrawal, and original group join", async () => {
    const batch = await prisma.sourceBatch.findUniqueOrThrow({
      where: {
        groupId_channelId_sourceDate: {
          groupId: "financial-schema-group",
          channelId: "financial-schema-channel",
          sourceDate: "2026-08-01",
        },
      },
    });
    const order = await prisma.customerOrder.create({
      data: {
        phone: "13800138000",
        batchId: batch.id,
        enteredById: "financial-schema-actor",
        openedOn: "2026-08-02",
        initialDepositCents: 50_000,
      },
    });
    const join = await prisma.metricEvent.create({
      data: {
        batchId: batch.id,
        enteredById: "financial-schema-actor",
        occurredOn: "2026-08-02",
        kind: "GROUP_JOIN",
        quantity: 4,
      },
    });
    await prisma.metricEvent.createMany({ data: [
      {
        batchId: batch.id,
        enteredById: "financial-schema-actor",
        occurredOn: "2026-08-03",
        kind: "GROUP_LEAVE",
        quantity: 1,
        parentEventId: join.id,
      },
      {
        batchId: batch.id,
        enteredById: "financial-schema-actor",
        occurredOn: "2026-08-03",
        kind: "RECHARGE",
        amountCents: 20_000,
        customerOrderId: order.id,
        continuationNumber: 1,
      },
      {
        batchId: batch.id,
        enteredById: "financial-schema-actor",
        occurredOn: "2026-08-04",
        kind: "WITHDRAWAL",
        amountCents: 5_000,
        customerOrderId: order.id,
      },
    ] });

    const stored = await prisma.customerOrder.findUniqueOrThrow({
      where: { phone: "13800138000" },
      include: { events: { orderBy: { occurredOn: "asc" } } },
    });
    expect(stored.initialDepositCents).toBe(50_000);
    expect(stored.events.map((event) => [event.kind, event.continuationNumber])).toEqual([
      ["RECHARGE", 1],
      ["WITHDRAWAL", null],
    ]);
    expect(await prisma.metricEvent.findFirstOrThrow({
      where: { parentEventId: join.id },
      select: { kind: true, quantity: true },
    })).toEqual({ kind: "GROUP_LEAVE", quantity: 1 });
  });
});
