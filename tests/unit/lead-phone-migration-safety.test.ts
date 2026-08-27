import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const SQLITE_MIGRATION_TEST_TIMEOUT_MS = 15_000;

function createLegacyDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "lead-phone-migration-safety-"));
  const databasePath = join(directory, "legacy.db");
  temporaryDirectories.push(directory);
  execFileSync("sqlite3", [databasePath], {
    input: `
      CREATE TABLE "LeadCustomer" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "phone" TEXT NOT NULL,
        "batchId" TEXT NOT NULL,
        "ownerId" TEXT NOT NULL
      );
      CREATE UNIQUE INDEX "LeadCustomer_batchId_phone_key"
        ON "LeadCustomer"("batchId", "phone");
      INSERT INTO "LeadCustomer" VALUES
        ('lead-a', '13800138000', 'batch-a', 'owner-a'),
        ('lead-b', '13800138000', 'batch-b', 'owner-b');
    `,
  });
  return databasePath;
}

function createEmptyDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "lead-phone-migration-safety-"));
  const databasePath = join(directory, "empty.db");
  temporaryDirectories.push(directory);
  execFileSync("sqlite3", [databasePath, "PRAGMA user_version = 0;"]);
  return databasePath;
}

function readLeadRows(databasePath: string) {
  return execFileSync("sqlite3", [databasePath, "SELECT id, phone, batchId, ownerId FROM LeadCustomer ORDER BY id;"])
    .toString();
}

function sqliteEnvironment(databasePath: string, overrides: Record<string, string | undefined> = {}) {
  return {
    ...process.env,
    SQLITE_DATABASE_URL: `file:${databasePath}`,
    CONFIRM_SQLITE_DATABASE_PATH: "YES",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.sequential("lead phone migration safety check", () => {
  it("blocks cross-batch duplicate phones before migration without changing legacy rows", () => {
    const databasePath = createLegacyDatabase();
    const before = readLeadRows(databasePath);

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-lead-phone-duplicates.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(databasePath),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LEAD_PHONE_DUPLICATES_FOUND");
    expect(result.stderr).toContain("*******8000");
    expect(result.stderr).not.toContain("13800138000");
    expect(result.stderr).toContain("lead-a");
    expect(result.stderr).toContain("lead-b");
    expect(readLeadRows(databasePath)).toBe(before);
  });

  it("allows the first migration of an empty database before LeadCustomer exists", () => {
    const databasePath = createEmptyDatabase();

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-lead-phone-duplicates.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(databasePath),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("LEAD_PHONE_DUPLICATES_FOUND");
    expect(result.stderr).not.toContain("LEAD_PHONE_DUPLICATE_CHECK_FAILED");
  });

  it("runs the duplicate check before the SQLite migration command", () => {
    const databasePath = createLegacyDatabase();
    const before = readLeadRows(databasePath);

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/migrate-sqlite-safely.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(databasePath),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("LEAD_PHONE_DUPLICATES_FOUND");
    expect(readLeadRows(databasePath)).toBe(before);
  });

  it("continues through every SQLite migration when the safety check passes", () => {
    const databasePath = createEmptyDatabase();

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/migrate-sqlite-safely.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(databasePath),
      encoding: "utf8",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(execFileSync("sqlite3", [databasePath, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'LeadCustomer_phone_key';"]).toString().trim())
      .toBe("LeadCustomer_phone_key");
  }, SQLITE_MIGRATION_TEST_TIMEOUT_MS);

  it("uses the explicitly confirmed SQLite target instead of a leftover DATABASE_URL", () => {
    const databasePath = createLegacyDatabase();

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-lead-phone-duplicates.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(databasePath, {
        DATABASE_URL: "postgresql://127.0.0.1:1/database_that_must_not_be_used",
      }),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LEAD_PHONE_DUPLICATES_FOUND");
  });

  it("regenerates the SQLite Prisma Client before auditing", () => {
    const databasePath = createLegacyDatabase();

    try {
      execFileSync("npm", ["run", "db:generate:postgres"], { cwd: process.cwd(), stdio: "pipe" });
      const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-lead-phone-duplicates.mjs")], {
        cwd: process.cwd(),
        env: sqliteEnvironment(databasePath),
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("LEAD_PHONE_DUPLICATES_FOUND");
    } finally {
      execFileSync("npm", ["run", "db:generate:sqlite"], { cwd: process.cwd(), stdio: "pipe" });
    }
  }, 15_000);

  it("rejects a non-SQLite target before opening a database connection", () => {
    const databasePath = createEmptyDatabase();

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-lead-phone-duplicates.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(databasePath, { SQLITE_DATABASE_URL: "postgresql://127.0.0.1:1/not-sqlite" }),
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("SQLITE_MIGRATION_TARGET_INVALID");
  });

  it("rejects a missing custom SQLite file instead of creating a database at a typo", () => {
    const directory = mkdtempSync(join(tmpdir(), "lead-phone-migration-safety-"));
    temporaryDirectories.push(directory);
    const missingDatabasePath = join(directory, "misspelled.db");

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-lead-phone-duplicates.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(missingDatabasePath),
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("SQLITE_MIGRATION_TARGET_MISSING");
  });

  it("rejects an encoded custom path that cannot be decoded", () => {
    const databasePath = createEmptyDatabase();

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/check-lead-phone-duplicates.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(databasePath, { SQLITE_DATABASE_URL: "file:/tmp/%ZZ.db" }),
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("SQLITE_MIGRATION_TARGET_INVALID");
  });

  it("requires confirmation before a custom SQLite file reaches the migration wrapper", () => {
    const databasePath = createEmptyDatabase();

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/migrate-sqlite-safely.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, SQLITE_DATABASE_URL: `file:${databasePath}` },
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(`${result.stdout}\n${result.stderr}`).toContain("SQLITE_MIGRATION_TARGET_CONFIRMATION_REQUIRED");
  });

  it("keeps a leftover DATABASE_URL away from the migration wrapper", () => {
    const leftoverDatabasePath = createLegacyDatabase();
    const targetDatabasePath = createEmptyDatabase();

    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/migrate-sqlite-safely.mjs")], {
      cwd: process.cwd(),
      env: sqliteEnvironment(targetDatabasePath, { DATABASE_URL: `file:${leftoverDatabasePath}` }),
      encoding: "utf8",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(execFileSync("sqlite3", [targetDatabasePath, "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'LeadCustomer_phone_key';"]).toString().trim())
      .toBe("LeadCustomer_phone_key");
    expect(readLeadRows(leftoverDatabasePath)).toContain("lead-a|13800138000|batch-a|owner-a");
  }, SQLITE_MIGRATION_TEST_TIMEOUT_MS);
});
