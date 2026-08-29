import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertLocalPostgresSchemaReferenceDatabaseUrl,
  assertLocalPostgresTestDatabaseUrl,
  LOCAL_POSTGRES_SCHEMA_REFERENCE_DATABASE_URL,
  LOCAL_POSTGRES_TEST_DATABASE_URL,
} from "../../scripts/postgres-test-database-safety.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const sqliteSchema = readFileSync("prisma/schema.prisma", "utf8");
const migrationScript = readFileSync("scripts/migrate-sqlite-to-postgres.mjs", "utf8");
const prepareScript = readFileSync("scripts/prepare-postgres-migration-test.mjs", "utf8");

describe("SQLite to PostgreSQL rehearsal safety", () => {
  it("accepts only the fixed local test database URL", () => {
    expect(assertLocalPostgresTestDatabaseUrl(LOCAL_POSTGRES_TEST_DATABASE_URL)).toBe(
      LOCAL_POSTGRES_TEST_DATABASE_URL,
    );
    expect(assertLocalPostgresSchemaReferenceDatabaseUrl(LOCAL_POSTGRES_SCHEMA_REFERENCE_DATABASE_URL)).toBe(
      LOCAL_POSTGRES_SCHEMA_REFERENCE_DATABASE_URL,
    );
    for (const unsafeUrl of [
      "postgresql://data_statistics_test:local_test_only_change_me@localhost:55432/data_statistics_test?schema=public",
      "postgresql://data_statistics_test:local_test_only_change_me@127.0.0.1:5432/data_statistics_test?schema=public",
      "postgresql://data_statistics_test:local_test_only_change_me@127.0.0.1:55432/production?schema=public",
      "postgresql://other:local_test_only_change_me@127.0.0.1:55432/data_statistics_test?schema=public",
      "postgresql://data_statistics_test:local_test_only_change_me@127.0.0.1:55432/data_statistics_test?schema=private",
      "postgresql://data_statistics_test:local_test_only_change_me@127.0.0.1:55432/data_statistics_test?schema=public&sslmode=require",
    ]) {
      expect(() => assertLocalPostgresTestDatabaseUrl(unsafeUrl)).toThrow(/固定本地测试库/);
    }
    expect(() => assertLocalPostgresSchemaReferenceDatabaseUrl(LOCAL_POSTGRES_TEST_DATABASE_URL))
      .toThrow(/固定本地测试库/);
  });

  it("replays the target from zero and compares it with a datamodel-built reference", () => {
    expect(packageJson.scripts["db:postgres:test:prepare"]).toBe(
      "node scripts/prepare-postgres-migration-test.mjs",
    );
    expect(prepareScript).toContain('"scripts/postgres-reset-test-schema.sql"');
    expect(prepareScript).toContain('"migrate", "deploy"');
    expect(prepareScript).toContain('"migrate", "status"');
    expect(prepareScript).toContain('"db", "push", "--force-reset", "--skip-generate"');
    expect(prepareScript).toContain('"scripts/postgres-native-test-schema.sql"');
    expect(prepareScript).toContain('"migrate", "diff", "--exit-code"');
    expect(prepareScript).toContain('"--to-url", referenceDatabaseUrl');
    expect(prepareScript).toContain("搬运目标库必须从空库完整重放正式 migrations");
  });

  it("uses the authoritative SQLite schema client and covers every model except Session", () => {
    expect(sqliteSchema).toContain('output   = "../node_modules/.prisma/sqlite-migration-client"');
    expect(migrationScript).toContain(".prisma/sqlite-migration-client/index.js");
    expect(migrationScript).not.toContain("sqlite-legacy-client");
    expect(migrationScript).not.toContain("prisma/sqlite/schema.prisma");

    const schemaModels = [...sqliteSchema.matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]);
    const plannedModels = [...migrationScript.matchAll(/^\s+\["[^"]+",\s*"(\w+)"\],$/gm)]
      .map((match) => match[1]);
    expect(plannedModels.sort()).toEqual(schemaModels.filter((model) => model !== "Session").sort());
    expect(migrationScript).toContain('const sessionCount = await transaction.session.count()');
    expect(migrationScript).toContain("target.$transaction");
  });
});
