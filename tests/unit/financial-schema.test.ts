import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  it("persists member stage fields", async () => {
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
    await prisma.metricEvent.create({ data: {
      batchId: batch.id,
      enteredById: "financial-schema-actor",
      occurredOn: "2026-08-03",
      kind: "GROUP_LEAVE",
      quantity: 1,
      parentEventId: join.id,
    } });
    await prisma.customerFinanceEvent.createMany({ data: [
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

  it("backfills old customer finance rows without deleting the rollback ledger", async () => {
    const [sqliteMigration, postgresMigration] = await Promise.all([
      readFile("prisma/migrations/20260830230000_decouple_customer_finance_events/migration.sql", "utf8"),
      readFile("prisma/postgres/migrations/20260830230000_decouple_customer_finance_events/migration.sql", "utf8"),
    ]);
    for (const migration of [sqliteMigration, postgresMigration]) {
      expect(migration).toContain('FROM "MetricEvent"');
      expect(migration).toContain('"kind" IN (\'RECHARGE\', \'WITHDRAWAL\')');
      expect(migration).not.toMatch(/DELETE\s+FROM\s+"MetricEvent"/i);
    }
    expect(sqliteMigration).toContain("INSERT OR IGNORE");
    expect(postgresMigration).toContain('ON CONFLICT ("id") DO NOTHING');

    const backfillDatabase = join(databaseDirectory, "finance-backfill.db");
    await execFile("sqlite3", [backfillDatabase, `
      CREATE TABLE "SourceBatch" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "CustomerOrder" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "MetricEvent" (
        "id" TEXT PRIMARY KEY, "batchId" TEXT NOT NULL, "customerOrderId" TEXT,
        "enteredById" TEXT NOT NULL, "occurredOn" TEXT NOT NULL, "kind" TEXT NOT NULL,
        "amountCents" INTEGER, "depositMethod" TEXT, "continuationNumber" INTEGER,
        "voidedAt" DATETIME, "voidReason" TEXT, "voidedById" TEXT, "createdAt" DATETIME NOT NULL
      );
      INSERT INTO "SourceBatch" VALUES ('batch');
      INSERT INTO "User" VALUES ('actor');
      INSERT INTO "CustomerOrder" VALUES ('order');
      INSERT INTO "MetricEvent" VALUES
        ('recharge', 'batch', 'order', 'actor', '2026-08-02', 'RECHARGE', 2500, 'BANK', 1, NULL, NULL, NULL, '2026-08-02T12:00:00Z'),
        ('withdrawal', 'batch', 'order', 'actor', '2026-08-03', 'WITHDRAWAL', 500, NULL, NULL, NULL, NULL, NULL, '2026-08-03T12:00:00Z'),
        ('reply', 'batch', NULL, 'actor', '2026-08-03', 'REPLIES', NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-03T12:00:00Z');
    `]);
    await execFile("sqlite3", [backfillDatabase, sqliteMigration.replace(/^--.*\n/gm, "")]);
    // Replaying only the copy statement is safe: existing ids are ignored and amounts are not doubled.
    const copyStatement = sqliteMigration.match(/INSERT OR IGNORE[\s\S]*?;\n/)?.[0];
    expect(copyStatement).toBeTruthy();
    await execFile("sqlite3", [backfillDatabase, copyStatement!]);
    const [financeRows, legacyRows] = await Promise.all([
      execFile("sqlite3", ["-json", backfillDatabase, 'SELECT "id", "kind", "amountCents", "continuationNumber" FROM "CustomerFinanceEvent" ORDER BY "id";']),
      execFile("sqlite3", ["-json", backfillDatabase, 'SELECT COUNT(*) AS "legacyCount" FROM "MetricEvent";']),
    ]);
    expect(JSON.parse(financeRows.stdout)).toEqual([
      { id: "recharge", kind: "RECHARGE", amountCents: 2500, continuationNumber: 1 },
      { id: "withdrawal", kind: "WITHDRAWAL", amountCents: 500, continuationNumber: null },
    ]);
    expect(JSON.parse(legacyRows.stdout)).toEqual([{ legacyCount: 3 }]);
  });
});
