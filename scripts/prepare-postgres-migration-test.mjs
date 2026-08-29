import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertLocalPostgresSchemaReferenceDatabaseUrl,
  assertLocalPostgresTestDatabaseUrl,
  LOCAL_POSTGRES_SCHEMA_REFERENCE_DATABASE_URL,
  LOCAL_POSTGRES_TEST_DATABASE_URL,
} from "./postgres-test-database-safety.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const databaseUrl = assertLocalPostgresTestDatabaseUrl(
  process.env.POSTGRES_TEST_DATABASE_URL ?? LOCAL_POSTGRES_TEST_DATABASE_URL,
);
const referenceDatabaseUrl = assertLocalPostgresSchemaReferenceDatabaseUrl(
  process.env.POSTGRES_SCHEMA_REFERENCE_DATABASE_URL ?? LOCAL_POSTGRES_SCHEMA_REFERENCE_DATABASE_URL,
);
const prisma = resolve(projectRoot, "node_modules/.bin/prisma");

function run(args, databaseUrlOverride = databaseUrl) {
  execFileSync(prisma, args, {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrlOverride },
    stdio: "inherit",
  });
}

// 搬运目标库必须从空库完整重放正式 migrations；固定本地 URL 已在上方严格校验。
// 不调用 migrate reset，避免依赖交互式确认；只对已锁定的本地测试库执行显式重建 SQL。
run(["db", "execute", "--url", databaseUrl, "--file", "scripts/postgres-reset-test-schema.sql"]);
run(["migrate", "deploy", "--schema", "prisma/postgres/schema.prisma"]);
run(["migrate", "status", "--schema", "prisma/postgres/schema.prisma"]);

// 参考库只用于结构比对：由当前权威 datamodel 生成，再补 Prisma schema 无法表达的
// 原生部分索引。这样才能发现“schema 已改但忘记写 migration”，而不是拿两套同样
// 由 migrations 建出的库互相比、得出没有意义的相同结论。
run(["db", "push", "--force-reset", "--skip-generate", "--schema", "prisma/postgres/schema.prisma"], referenceDatabaseUrl);
run(["db", "execute", "--url", referenceDatabaseUrl, "--file", "scripts/postgres-native-test-schema.sql"], referenceDatabaseUrl);
run([
  "migrate", "diff", "--exit-code",
  "--from-url", databaseUrl,
  "--to-url", referenceDatabaseUrl,
]);
run(["generate", "--schema", "prisma/schema.prisma"], "file:./dev.db");
run(["generate", "--schema", "prisma/postgres/schema.prisma"]);

console.log("本地 PostgreSQL 搬运测试库已按正式 migrations 准备完成，schema drift 校验通过");
