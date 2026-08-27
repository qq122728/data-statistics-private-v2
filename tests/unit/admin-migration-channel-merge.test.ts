import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixtureSql = `
PRAGMA foreign_keys=ON;
CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "username" TEXT, "name" TEXT, "passwordHash" TEXT, "role" TEXT, "active" BOOLEAN, "groupId" TEXT, "createdAt" DATETIME, "updatedAt" DATETIME, FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id"));
CREATE TABLE "TeamGroup" ("id" TEXT PRIMARY KEY, "name" TEXT, "active" BOOLEAN, "createdAt" DATETIME, "updatedAt" DATETIME);
CREATE TABLE "Channel" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL, "groupId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, PRIMARY KEY ("id", "groupId"), FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id"));
CREATE TABLE "SourceBatch" ("id" TEXT PRIMARY KEY, "groupId" TEXT NOT NULL, "channelId" TEXT NOT NULL, "sourceDate" TEXT NOT NULL, "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL, UNIQUE ("groupId", "channelId", "sourceDate"), FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id"), FOREIGN KEY ("channelId", "groupId") REFERENCES "Channel" ("id", "groupId"));
CREATE TABLE "MetricEvent" ("id" TEXT PRIMARY KEY, "batchId" TEXT NOT NULL, "enteredById" TEXT NOT NULL, "occurredOn" TEXT NOT NULL, "kind" TEXT NOT NULL, "quantity" INTEGER, "amountCents" INTEGER, "createdAt" DATETIME NOT NULL, FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id"), FOREIGN KEY ("enteredById") REFERENCES "User" ("id"));
INSERT INTO "TeamGroup" VALUES ('group-a', '一组', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "User" VALUES ('user-1', 'user-1', '成员', '', 'RECEPTION', 1, 'group-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "Channel" VALUES ('channel-a', '  同名   渠道 ', 1, 'group-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "Channel" VALUES ('channel-b', '同名 渠道', 0, 'group-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SourceBatch" VALUES ('batch-a', 'group-a', 'channel-a', '2026-08-10', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SourceBatch" VALUES ('batch-b', 'group-a', 'channel-b', '2026-08-10', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "SourceBatch" VALUES ('batch-c', 'group-a', 'channel-b', '2026-08-11', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "MetricEvent" VALUES ('event-a', 'batch-a', 'user-1', '2026-08-10', 'REPLIES', 1, NULL, CURRENT_TIMESTAMP);
INSERT INTO "MetricEvent" VALUES ('event-b', 'batch-b', 'user-1', '2026-08-10', 'REPLIES', 2, NULL, CURRENT_TIMESTAMP);
INSERT INTO "MetricEvent" VALUES ('event-c', 'batch-c', 'user-1', '2026-08-11', 'REPLIES', 3, NULL, CURRENT_TIMESTAMP);
`;

describe("admin center channel normalization migration", () => {
  it("merges duplicate channels, conflicting batches, and their events into deterministic canonical rows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "admin-channel-migration-"));
    temporaryDirectories.push(directory);
    const database = join(directory, "fixture.db");
    const migration = await readFile(new URL("../../prisma/migrations/20260811160000_admin_center_foundation/migration.sql", import.meta.url), "utf8");
    execFileSync("sqlite3", [database], { input: `${fixtureSql}\n${migration}` });

    const query = (sql: string) => JSON.parse(execFileSync("sqlite3", [database, "-json", sql], { encoding: "utf8" }) || "[]") as Array<Record<string, unknown>>;
    expect(query('SELECT "id", "normalizedName" FROM "Channel" ORDER BY "id"')).toEqual([
      { id: "channel-a", normalizedName: "同名 渠道" },
    ]);
    expect(query('SELECT "id", "channelId", "sourceDate" FROM "SourceBatch" ORDER BY "sourceDate"')).toEqual([
      { id: "batch-a", channelId: "channel-a", sourceDate: "2026-08-10" },
      { id: "batch-c", channelId: "channel-a", sourceDate: "2026-08-11" },
    ]);
    expect(query('SELECT "id", "batchId" FROM "MetricEvent" ORDER BY "id"')).toEqual([
      { id: "event-a", batchId: "batch-a" },
      { id: "event-b", batchId: "batch-a" },
      { id: "event-c", batchId: "batch-c" },
    ]);
    expect(query('PRAGMA foreign_key_check')).toEqual([]);
  });
});
