import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_POSTGRES_MIGRATION_TESTS === "1";
const databaseUrl = "postgresql://data_statistics_test:local_test_only_change_me@127.0.0.1:55432/data_statistics_test?schema=public";
const composeArgs = ["compose", "-p", "data_statistics", "-f", "compose.postgres-test.yaml"];
let databaseReady = false;
const temporaryDirectories: string[] = [];

function compose(...args: string[]) {
  return execFileSync("docker", [...composeArgs, ...args], { cwd: process.cwd(), stdio: "pipe" });
}

function psql(sql: string) {
  return execFileSync("docker", [...composeArgs, "exec", "-T", "postgres-test", "psql", "-v", "ON_ERROR_STOP=1", "-U", "data_statistics_test", "-d", "data_statistics_test", "-c", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function deploy(schemaPath = "prisma/postgres/schema.prisma") {
  return spawnSync("npx", ["prisma", "migrate", "deploy", "--schema", schemaPath], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
}

function createLegacySchemaPath() {
  const directory = mkdtempSync(join(tmpdir(), "postgres-active-lead-legacy-"));
  temporaryDirectories.push(directory);
  const legacyPrismaDirectory = join(directory, "prisma");
  cpSync(join(process.cwd(), "prisma/postgres"), legacyPrismaDirectory, { recursive: true });
  rmSync(join(legacyPrismaDirectory, "migrations/20260821022000_enforce_one_active_lead_per_group"), { recursive: true });
  return join(legacyPrismaDirectory, "schema.prisma");
}

function resetDatabase() {
  psql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

function insertDuplicateActiveLeads() {
  psql(`
    INSERT INTO "Department" ("id", "name", "countryCode", "timezone", "workStartMinutes", "workEndMinutes", "createdAt", "updatedAt")
    VALUES ('postgres-constraint-department', 'PostgreSQL 约束测试公司', 'CN', 'Asia/Shanghai', 600, 1320, NOW(), NOW());
    INSERT INTO "TeamGroup" ("id", "name", "departmentId", "createdAt", "updatedAt")
    VALUES ('postgres-constraint-group', 'PostgreSQL 约束测试组', 'postgres-constraint-department', NOW(), NOW());
    INSERT INTO "User" ("id", "username", "name", "passwordHash", "role", "active", "groupId", "createdAt", "updatedAt")
    VALUES
      ('postgres-constraint-lead-a', 'postgres-constraint-lead-a', '组长甲', 'test', 'LEAD', true, 'postgres-constraint-group', NOW(), NOW()),
      ('postgres-constraint-lead-b', 'postgres-constraint-lead-b', '组长乙', 'test', 'LEAD', true, 'postgres-constraint-group', NOW(), NOW());
  `);
}

describe.skipIf(!enabled).sequential("PostgreSQL active-lead migration safety", () => {
  beforeAll(() => {
    compose("down", "--volumes", "--remove-orphans");
    compose("up", "-d", "--wait");
    databaseReady = true;
  });

  afterAll(() => {
    if (databaseReady) resetDatabase();
    temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  it("blocks deployment before adding the unique index when historical active-lead conflicts exist", () => {
    resetDatabase();
    expect(deploy(createLegacySchemaPath()).status).toBe(0);
    insertDuplicateActiveLeads();

    const result = deploy();

    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain("POSTGRES_ACTIVE_LEAD_CONFLICT");
  });

  it("enforces at most one active lead per group after a clean deployment", () => {
    resetDatabase();
    expect(deploy().status).toBe(0);
    psql(`
      INSERT INTO "Department" ("id", "name", "countryCode", "timezone", "workStartMinutes", "workEndMinutes", "createdAt", "updatedAt")
      VALUES ('postgres-constraint-department', 'PostgreSQL 约束测试公司', 'CN', 'Asia/Shanghai', 600, 1320, NOW(), NOW());
      INSERT INTO "TeamGroup" ("id", "name", "departmentId", "createdAt", "updatedAt")
      VALUES ('postgres-constraint-group', 'PostgreSQL 约束测试组', 'postgres-constraint-department', NOW(), NOW());
      INSERT INTO "User" ("id", "username", "name", "passwordHash", "role", "active", "groupId", "createdAt", "updatedAt")
      VALUES ('postgres-constraint-lead-a', 'postgres-constraint-lead-a', '组长甲', 'test', 'LEAD', true, 'postgres-constraint-group', NOW(), NOW());
    `);

    const duplicate = spawnSync("docker", [...composeArgs, "exec", "-T", "postgres-test", "psql", "-v", "ON_ERROR_STOP=1", "-U", "data_statistics_test", "-d", "data_statistics_test", "-c", `
      INSERT INTO "User" ("id", "username", "name", "passwordHash", "role", "active", "groupId", "createdAt", "updatedAt")
      VALUES ('postgres-constraint-lead-b', 'postgres-constraint-lead-b', '组长乙', 'test', 'LEAD', true, 'postgres-constraint-group', NOW(), NOW());
    `], { cwd: process.cwd(), encoding: "utf8" });

    expect(duplicate.status, `${duplicate.stdout}\n${duplicate.stderr}`).not.toBe(0);
    expect(`${duplicate.stdout}\n${duplicate.stderr}`).toContain("User_one_active_lead_per_group");
  });
});
