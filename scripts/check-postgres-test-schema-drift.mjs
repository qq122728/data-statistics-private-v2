import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertLocalPostgresSchemaReferenceDatabaseUrl,
  assertLocalPostgresTestDatabaseUrl,
} from "./postgres-test-database-safety.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const databaseUrl = assertLocalPostgresTestDatabaseUrl(process.env.POSTGRES_TEST_DATABASE_URL);
const referenceDatabaseUrl = assertLocalPostgresSchemaReferenceDatabaseUrl(
  process.env.POSTGRES_SCHEMA_REFERENCE_DATABASE_URL,
);

execFileSync(resolve(projectRoot, "node_modules/.bin/prisma"), [
  "migrate", "diff", "--exit-code",
  "--from-url", databaseUrl,
  "--to-url", referenceDatabaseUrl,
], { cwd: projectRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "inherit" });

console.log("本地 PostgreSQL 测试库与权威 PostgreSQL schema 一致");
