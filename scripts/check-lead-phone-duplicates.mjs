import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const projectRoot = process.cwd();
const defaultDatabaseUrl = "file:./dev.db";

function failTarget(marker, message) {
  console.error(marker);
  console.error(message);
  process.exit(2);
}

function resolveTarget() {
  const customDatabaseUrl = process.env.SQLITE_DATABASE_URL?.trim();
  const databaseUrl = customDatabaseUrl || defaultDatabaseUrl;
  if (!databaseUrl.startsWith("file:")) {
    failTarget("SQLITE_MIGRATION_TARGET_INVALID", "SQLite 升级只接受 file: 开头的数据库地址。PostgreSQL 请使用 db:migrate:postgres。");
  }

  const pathWithoutQuery = databaseUrl.slice("file:".length).split("?", 1)[0];
  if (!pathWithoutQuery) {
    failTarget("SQLITE_MIGRATION_TARGET_INVALID", "SQLite 数据库地址缺少文件路径。");
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathWithoutQuery);
  } catch {
    failTarget("SQLITE_MIGRATION_TARGET_INVALID", "SQLite 数据库文件路径包含无效的 URL 编码。");
  }
  const absolutePath = isAbsolute(decodedPath)
    ? resolve(decodedPath)
    : resolve(projectRoot, "prisma", decodedPath);

  if (customDatabaseUrl && process.env.CONFIRM_SQLITE_DATABASE_PATH !== "YES") {
    failTarget(
      "SQLITE_MIGRATION_TARGET_CONFIRMATION_REQUIRED",
      `自定义 SQLite 文件必须设置 CONFIRM_SQLITE_DATABASE_PATH=YES。目标：${absolutePath}`,
    );
  }
  if (customDatabaseUrl && !existsSync(absolutePath)) {
    failTarget(
      "SQLITE_MIGRATION_TARGET_MISSING",
      `自定义 SQLite 文件不存在，已拒绝自动新建，避免把路径拼写错误当成新数据库：${absolutePath}`,
    );
  }

  console.log(`SQLite 迁移检查目标：${absolutePath}`);
  return databaseUrl;
}

function generateSqliteClient(databaseUrl) {
  const executable = join(
    projectRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
  const result = spawnSync(executable, ["generate", "--schema", "prisma/schema.prisma"], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    console.error("SQLITE_PRISMA_CLIENT_GENERATION_FAILED");
    if (result.error) console.error(result.error.message);
    process.exit(2);
  }
}

function maskPhone(phone) {
  const value = String(phone);
  const visibleSuffix = value.slice(-4);
  return `${"*".repeat(Math.max(0, value.length - visibleSuffix.length))}${visibleSuffix}`;
}

const databaseUrl = resolveTarget();
generateSqliteClient(databaseUrl);
process.env.DATABASE_URL = databaseUrl;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

try {
  const tables = await prisma.$queryRawUnsafe(`
    SELECT "name"
    FROM "sqlite_master"
    WHERE "type" = 'table' AND "name" = 'LeadCustomer'
  `);

  if (tables.length === 0) {
    console.log("LeadCustomer 表尚未创建：允许执行首次数据库迁移。");
  } else {
    const duplicates = await prisma.$queryRawUnsafe(`
      SELECT
        "phone",
        CAST(COUNT(*) AS TEXT) AS "duplicateCount",
        GROUP_CONCAT("id", ',') AS "leadIds",
        GROUP_CONCAT("batchId", ',') AS "batchIds",
        GROUP_CONCAT("ownerId", ',') AS "ownerIds"
      FROM "LeadCustomer"
      GROUP BY "phone"
      HAVING COUNT(*) > 1
      ORDER BY "phone"
    `);

    if (duplicates.length === 0) {
      console.log("LeadCustomer 手机号迁移检查通过：未发现重复手机号。");
    } else {
      console.error("LEAD_PHONE_DUPLICATES_FOUND");
      console.error("检测到跨批次重复手机号。为避免误删客户资料，本次数据库升级已停止。");
      for (const row of duplicates) {
        console.error(
          `手机号 ${maskPhone(row.phone)}：${row.duplicateCount} 条；客户 ID ${row.leadIds}；批次 ID ${row.batchIds}；负责人 ID ${row.ownerIds}`,
        );
      }
      console.error("请先备份数据库并人工确认需要保留的客户档案，再重新执行升级。");
      process.exitCode = 1;
    }
  }
} catch (error) {
  console.error("LEAD_PHONE_DUPLICATE_CHECK_FAILED");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
