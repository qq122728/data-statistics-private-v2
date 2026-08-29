import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient as PostgresPrismaClient } from "../node_modules/.prisma/postgres-migration-client/index.js";
import { PrismaClient as SqlitePrismaClient } from "../node_modules/.prisma/sqlite-migration-client/index.js";
import { assertLocalPostgresTestDatabaseUrl } from "./postgres-test-database-safety.mjs";

// 按外键依赖排序。除 Session 外，权威 schema 的所有模型都必须出现在这里。
// Session 是旧登录凭证，故意不搬；搬完后所有人需要重新登录。
export const copyPlan = [
  ["company", "Company"],
  ["department", "Department"],
  ["teamGroup", "TeamGroup"],
  ["user", "User"],
  ["userRoleAssignment", "UserRoleAssignment"],
  ["userGroupMembership", "UserGroupMembership"],
  ["userPosition", "UserPosition"],
  ["channel", "Channel"],
  ["resourceChannelAccess", "ResourceChannelAccess"],
  ["sourceBatch", "SourceBatch"],
  ["device", "Device"],
  ["leadCustomer", "LeadCustomer"],
  ["customerOrder", "CustomerOrder"],
  ["metricEvent", "MetricEvent"],
  ["groupOperatorReception", "GroupOperatorReception"],
  ["groupOperatorReceptionHistory", "GroupOperatorReceptionHistory"],
  ["deviceAccount", "DeviceAccount"],
  ["leadActivity", "LeadActivity"],
  ["leadException", "LeadException"],
  ["invalidFanReport", "InvalidFanReport"],
  ["invalidFanReportAudit", "InvalidFanReportAudit"],
  ["dailyEntryConfirmation", "DailyEntryConfirmation"],
  ["attendanceRecord", "AttendanceRecord"],
  ["notification", "Notification"],
  ["notificationRecipient", "NotificationRecipient"],
  ["auditLog", "AuditLog"],
  ["riskDecision", "RiskDecision"],
  ["systemSetting", "SystemSetting"],
];

function chunks(rows, size = 500) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, normalizeValue(nestedValue)]));
  }
  return value;
}

function normalizedRows(rows) {
  return rows
    .map(normalizeValue)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function readSource(source) {
  const rowsByModel = new Map();
  for (const [model, label] of copyPlan) {
    const rows = await source[model].findMany();
    rowsByModel.set(model, rows);
    console.log(`${label} source: ${rows.length}`);
  }
  return rowsByModel;
}

async function copyModel(target, model, label, rows) {
  const data = model === "metricEvent"
    ? rows.map((row) => ({ ...row, parentEventId: null }))
    : rows;
  for (const batch of chunks(data)) {
    if (!batch.length) continue;
    const { count } = await target[model].createMany({ data: batch });
    if (count !== batch.length) {
      throw new Error(`${label} 复制行数不一致：读取 ${batch.length} 行，但仅写入 ${count} 行`);
    }
  }
}

async function verifyCopiedModels(target, sourceRowsByModel) {
  for (const [model, label] of copyPlan) {
    const sourceRows = sourceRowsByModel.get(model);
    const targetRows = await target[model].findMany();
    if (targetRows.length !== sourceRows.length) {
      throw new Error(`${label} 校验失败：SQLite 有 ${sourceRows.length} 行，PostgreSQL 有 ${targetRows.length} 行`);
    }
    if (JSON.stringify(normalizedRows(targetRows)) !== JSON.stringify(normalizedRows(sourceRows))) {
      throw new Error(`${label} 校验失败：字段或关联字段与 SQLite 源数据不一致`);
    }
    console.log(`${label} verified: ${targetRows.length}`);
  }
}

export async function migrateSqliteToPostgres({ source, target }) {
  // 先把源数据完整读入内存，再打开目标事务，缩短目标库锁定时间。
  const sourceRowsByModel = await readSource(source);
  const truncateTables = [...copyPlan.map(([, label]) => `"${label}"`), '"Session"'].join(", ");

  await target.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`TRUNCATE TABLE ${truncateTables} RESTART IDENTITY CASCADE`);

    for (const [model, label] of copyPlan) {
      await copyModel(transaction, model, label, sourceRowsByModel.get(model));
    }

    for (const event of sourceRowsByModel.get("metricEvent")) {
      if (event.parentEventId) {
        await transaction.metricEvent.update({
          where: { id: event.id },
          data: { parentEventId: event.parentEventId },
        });
      }
    }

    await verifyCopiedModels(transaction, sourceRowsByModel);
    const sessionCount = await transaction.session.count();
    if (sessionCount !== 0) throw new Error(`Session 清理失败：目标库仍有 ${sessionCount} 条旧登录会话`);
  }, { maxWait: 10_000, timeout: 600_000 });
}

async function main() {
  const postgresUrl = assertLocalPostgresTestDatabaseUrl(process.env.POSTGRES_TEST_DATABASE_URL);
  const sqliteUrl = `file:${resolve(process.cwd(), "prisma/dev.db")}`;
  const source = new SqlitePrismaClient({ datasourceUrl: sqliteUrl });
  const target = new PostgresPrismaClient({ datasourceUrl: postgresUrl });

  try {
    await migrateSqliteToPostgres({ source, target });
    console.log("Session: 0（按设计不复制旧登录会话，所有账号需重新登录）");
    console.log("SQLite → PostgreSQL 本地测试数据复制与逐表对账完成");
  } finally {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
