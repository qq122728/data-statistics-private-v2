import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forbiddenMigrationChanges } from "../../scripts/check-postgres-migration-diff.mjs";
import { deployPostgresMigrations, migrationDatabaseUrl } from "../../scripts/deploy-postgres-migrations.mjs";
import { verifyMigrationChecksums } from "../../scripts/verify-postgres-migration-checksums.mjs";

const temporaryDirectories: string[] = [];

function migrationCopy() {
  const directory = mkdtempSync(join(tmpdir(), "postgres-migrations-"));
  temporaryDirectories.push(directory);
  cpSync("prisma/postgres/migrations", directory, { recursive: true });
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("PostgreSQL migration immutability", () => {
  it("verifies every byte of all recorded migrations", () => {
    expect(verifyMigrationChecksums()).toMatchObject({ count: 41 });
  });

  it("detects a whitespace-only change to an executed migration", () => {
    const directory = migrationCopy();
    const migration = join(directory, "20260818150000_postgres_baseline/migration.sql");
    writeFileSync(migration, `${readFileSync(migration, "utf8")}\n`);

    expect(() => verifyMigrationChecksums({
      migrationsDirectory: directory,
      manifestPath: join(directory, "checksums.json"),
    })).toThrow("content changed: 20260818150000_postgres_baseline/migration.sql");
  });

  it("requires every new migration to be added to the manifest", () => {
    const directory = migrationCopy();
    const newMigration = join(directory, "20990101000000_unrecorded");
    mkdirSync(newMigration);
    writeFileSync(join(newMigration, "migration.sql"), "SELECT 1;\n");

    expect(() => verifyMigrationChecksums({
      migrationsDirectory: directory,
      manifestPath: join(directory, "checksums.json"),
    })).toThrow("not in manifest: 20990101000000_unrecorded/migration.sql");
  });

  it("allows a new migration but rejects modification, deletion, and rename in a Git diff", () => {
    const output = [
      "A\tprisma/postgres/migrations/20990101000000_new/migration.sql",
      "M\tprisma/postgres/migrations/20260818150000_postgres_baseline/migration.sql",
      "D\tprisma/postgres/migrations/20260818160000_add_advertising_fan_count_snapshot/migration.sql",
      "R100\tprisma/postgres/migrations/old/migration.sql\tprisma/postgres/migrations/new/migration.sql",
    ].join("\n");

    expect(forbiddenMigrationChanges(output)).toHaveLength(3);
  });
});

describe("safe PostgreSQL migration wrapper", () => {
  it("sets bounded lock and statement timeouts without dropping existing URL options", () => {
    const result = new URL(migrationDatabaseUrl(
      "postgresql://user:secret@db.example.test/app?schema=private&options=-c%20application_name%3Dmigration",
      { MIGRATION_LOCK_TIMEOUT_MS: "15000", MIGRATION_STATEMENT_TIMEOUT_MS: "900000" },
    ));

    expect(result.searchParams.get("schema")).toBe("private");
    expect(result.searchParams.get("options")).toBe(
      "-c application_name=migration -c lock_timeout=15000 -c statement_timeout=900000",
    );
  });

  it("rejects missing, non-PostgreSQL, and invalid timeout settings", () => {
    expect(() => migrationDatabaseUrl(undefined)).toThrow("MIGRATION_DATABASE_URL is required");
    expect(() => migrationDatabaseUrl("file:./dev.db")).toThrow("require a postgresql:// or postgres://");
    expect(() => migrationDatabaseUrl("postgresql://user:secret@localhost/app", {
      MIGRATION_LOCK_TIMEOUT_MS: "0",
    })).toThrow("MIGRATION_LOCK_TIMEOUT_MS");
  });

  it("stops and returns Prisma's failure status", () => {
    const spawn = vi.fn((
      _command: string,
      _arguments: string[],
      _options: { env: Record<string, string | undefined> },
    ) => ({ status: 1, stdout: "", stderr: "" }));
    expect(deployPostgresMigrations({
      environment: {
        DATABASE_URL: "postgresql://data_statistics_runtime:secret@localhost/app",
        MIGRATION_DATABASE_URL: "postgresql://data_statistics_migrator:secret@localhost/app",
      },
      spawn: spawn as never,
    })).toBe(1);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[0]).toBe("bash");
    expect(spawn.mock.calls[0]?.[1][0]).toMatch(/scripts\/run-postgres-migrations\.sh$/);
    const spawnedMigrationUrlRaw = spawn.mock.calls[0]?.[2]?.env.MIGRATION_DATABASE_URL;
    expect(spawnedMigrationUrlRaw).toBeTruthy();
    if (!spawnedMigrationUrlRaw) throw new Error("missing migration URL passed to DB-01 wrapper");
    const spawnedMigrationUrl = new URL(spawnedMigrationUrlRaw);
    expect(spawnedMigrationUrl.searchParams.get("options")).toContain("lock_timeout=10000");
  });
});
