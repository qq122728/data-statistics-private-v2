import { resolve } from "node:path";
import { PrismaClient as PostgresPrismaClient } from "../node_modules/.prisma/postgres-migration-client/index.js";
import { PrismaClient as SqlitePrismaClient } from "../node_modules/.prisma/sqlite-legacy-client/index.js";

const postgresUrl = process.env.POSTGRES_TEST_DATABASE_URL;
if (!postgresUrl || !postgresUrl.includes("127.0.0.1:55432/data_statistics_test")) {
  throw new Error("为避免误操作，只允许复制到本机 55432 端口的 data_statistics_test 测试库");
}

const sqliteUrl = `file:${resolve(process.cwd(), "prisma/dev.db")}`;
const source = new SqlitePrismaClient({ datasourceUrl: sqliteUrl });
const target = new PostgresPrismaClient({ datasourceUrl: postgresUrl });

const copyPlan = [
  ["department", "Department"],
  ["teamGroup", "TeamGroup"],
  ["user", "User"],
  ["userRoleAssignment", "UserRoleAssignment"],
  ["channel", "Channel"],
  ["sourceBatch", "SourceBatch"],
  ["device", "Device"],
  ["leadCustomer", "LeadCustomer"],
  ["customerOrder", "CustomerOrder"],
  ["metricEvent", "MetricEvent"],
  ["groupOperatorReception", "GroupOperatorReception"],
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

async function copyModel(model, label) {
  const rows = await source[model].findMany();
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
  console.log(`${label}: ${rows.length}`);
  return rows;
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

async function verifyCopiedModels(sourceRowsByModel) {
  for (const [model, label] of copyPlan) {
    const sourceRows = sourceRowsByModel.get(model);
    const targetRows = await target[model].findMany();
    if (targetRows.length !== sourceRows.length) {
      throw new Error(`${label} 校验失败：SQLite 有 ${sourceRows.length} 行，PostgreSQL 有 ${targetRows.length} 行`);
    }
    if (JSON.stringify(normalizedRows(targetRows)) !== JSON.stringify(normalizedRows(sourceRows))) {
      throw new Error(`${label} 校验失败：关键字段或关联字段与 SQLite 源数据不一致`);
    }
    console.log(`${label} verified: ${targetRows.length}`);
  }
}

try {
  await target.$executeRawUnsafe(`
    TRUNCATE TABLE
      "NotificationRecipient", "Notification", "AttendanceRecord", "AuditLog",
      "RiskDecision", "DailyEntryConfirmation", "Session", "InvalidFanReportAudit",
      "InvalidFanReport", "LeadException", "LeadActivity", "DeviceAccount",
      "GroupOperatorReception", "MetricEvent", "CustomerOrder", "LeadCustomer",
      "Device", "SourceBatch", "Channel", "UserRoleAssignment", "User",
      "TeamGroup", "Department", "SystemSetting"
    RESTART IDENTITY CASCADE
  `);

  let metricEvents = [];
  const sourceRowsByModel = new Map();
  for (const [model, label] of copyPlan) {
    const rows = await copyModel(model, label);
    sourceRowsByModel.set(model, rows);
    if (model === "metricEvent") metricEvents = rows;
  }

  for (const event of metricEvents) {
    if (event.parentEventId) {
      await target.metricEvent.update({ where: { id: event.id }, data: { parentEventId: event.parentEventId } });
    }
  }

  await verifyCopiedModels(sourceRowsByModel);

  console.log("Session: 0（按设计不复制旧登录会话）");
  console.log("SQLite → PostgreSQL 测试数据复制完成");
} finally {
  await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
}
