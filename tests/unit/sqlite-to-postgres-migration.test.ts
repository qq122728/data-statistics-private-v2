import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "../../node_modules/.prisma/postgres-migration-client/index.js";
import { afterAll, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const postgresUrl = process.env.POSTGRES_TEST_DATABASE_URL;
const fixtureId = "sqlite-postgres-copy-fixture";
let fixtureDirectory: string | undefined;
let target: PrismaClient | undefined;

async function seedCurrentReleaseData(databasePath: string) {
  const sql = `
    PRAGMA foreign_keys = ON;
    INSERT INTO "Department" ("id", "name", "updatedAt") VALUES ('${fixtureId}-department', '${fixtureId}-department', '2026-08-21T00:00:00.000Z');
    INSERT INTO "TeamGroup" ("id", "name", "departmentId", "updatedAt") VALUES ('${fixtureId}-group', '${fixtureId}-group', '${fixtureId}-department', '2026-08-21T00:00:00.000Z');
    INSERT INTO "User" ("id", "username", "name", "passwordHash", "role", "groupId", "departmentId", "updatedAt") VALUES ('${fixtureId}-user', '${fixtureId}-user', '迁移验证用户', 'hash', 'LEAD', '${fixtureId}-group', '${fixtureId}-department', '2026-08-21T00:00:00.000Z');
    INSERT INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt") VALUES ('${fixtureId}-role', '${fixtureId}-user', 'EXPERT', '2026-08-21T00:00:00.000Z');
    INSERT INTO "Channel" ("id", "groupId", "name", "normalizedName", "createdById", "createdAt", "updatedAt") VALUES ('${fixtureId}-channel', '${fixtureId}-group', '${fixtureId}-channel', '${fixtureId}-channel', '${fixtureId}-user', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
    INSERT INTO "SourceBatch" ("id", "groupId", "channelId", "sourceDate", "createdAt", "updatedAt") VALUES ('${fixtureId}-batch', '${fixtureId}-group', '${fixtureId}-channel', '2026-08-21', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
    INSERT INTO "LeadCustomer" ("id", "phone", "batchId", "ownerId", "customerEmail", "expertWorkflowStage", "expertTrackingStartedAt", "createdAt", "updatedAt") VALUES ('${fixtureId}-lead', '13900000001', '${fixtureId}-batch', '${fixtureId}-user', 'migration@example.test', 'TRACKING', '2026-08-21T01:02:03.000Z', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
    INSERT INTO "InvalidFanReport" ("id", "batchId", "reporterId", "status", "noWsCount", "lowAmountCount", "collisionCount", "reviewedById", "reviewReason", "createdAt", "updatedAt") VALUES ('${fixtureId}-report', '${fixtureId}-batch', '${fixtureId}-user', 'APPROVED', 2, 3, 4, '${fixtureId}-user', '验证审核原因', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:00.000Z');
    INSERT INTO "InvalidFanReportAudit" ("id", "reportId", "actorId", "action", "afterNoWsCount", "reason", "createdAt") VALUES ('${fixtureId}-audit', '${fixtureId}-report', '${fixtureId}-user', 'APPROVED', 2, '验证审计原因', '2026-08-21T00:00:00.000Z');
    INSERT INTO "AttendanceRecord" ("id", "userId", "groupId", "businessDate", "timezone", "scheduledStartMinutes", "scheduledEndMinutes", "clockInStatus", "leaveType", "leaveReason", "updatedAt") VALUES ('${fixtureId}-attendance', '${fixtureId}-user', '${fixtureId}-group', '2026-08-21', 'Asia/Shanghai', 600, 1320, 'LATE', 'SICK', '迁移病假', '2026-08-21T00:00:00.000Z');
    INSERT INTO "Notification" ("id", "title", "content", "type", "requiresAck", "targetType", "senderId", "targetRole", "createdAt") VALUES ('${fixtureId}-notification', '迁移通知', '当前发布通知内容', 'IMPORTANT', true, 'ROLE', '${fixtureId}-user', 'EXPERT', '2026-08-21T00:00:00.000Z');
    INSERT INTO "NotificationRecipient" ("id", "notificationId", "userId", "readAt", "acknowledgedAt") VALUES ('${fixtureId}-recipient', '${fixtureId}-notification', '${fixtureId}-user', '2026-08-21T02:00:00.000Z', '2026-08-21T02:01:00.000Z');
  `;
  execFileSync("sqlite3", [databasePath], { input: sql });
}

afterAll(async () => {
  await target?.$disconnect();
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

describe.runIf(postgresUrl)("SQLite to PostgreSQL current-release migration", () => {
  it("copies current release records and their links without silently dropping fields", async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "sqlite-postgres-copy-"));
    const fixtureDatabasePath = join(fixtureDirectory, "prisma", "dev.db");
    await mkdir(join(fixtureDirectory, "prisma"));
    await cp(resolve(process.cwd(), "prisma/dev.db"), fixtureDatabasePath);
    await seedCurrentReleaseData(fixtureDatabasePath);

    await execFile(process.execPath, [resolve(process.cwd(), "scripts/migrate-sqlite-to-postgres.mjs")], {
      cwd: fixtureDirectory,
      env: { ...process.env, POSTGRES_TEST_DATABASE_URL: postgresUrl },
    });

    target = new PrismaClient({ datasourceUrl: postgresUrl });
    await expect(target.userRoleAssignment.findUnique({
      where: { userId_role: { userId: `${fixtureId}-user`, role: "EXPERT" } },
    })).resolves.toMatchObject({ id: `${fixtureId}-role` });
    await expect(target.leadCustomer.findUnique({ where: { id: `${fixtureId}-lead` } })).resolves.toMatchObject({
      customerEmail: "migration@example.test",
      expertWorkflowStage: "TRACKING",
    });
    await expect(target.invalidFanReport.findUnique({
      where: { id: `${fixtureId}-report` },
      include: { audits: true },
    })).resolves.toMatchObject({
      status: "APPROVED",
      reviewReason: "验证审核原因",
      audits: [expect.objectContaining({ id: `${fixtureId}-audit`, action: "APPROVED", reason: "验证审计原因" })],
    });
    await expect(target.attendanceRecord.findUnique({
      where: { userId_businessDate: { userId: `${fixtureId}-user`, businessDate: "2026-08-21" } },
    })).resolves.toMatchObject({
      id: `${fixtureId}-attendance`,
      clockInStatus: "LATE",
      leaveType: "SICK",
      leaveReason: "迁移病假",
    });
    await expect(target.notification.findUnique({
      where: { id: `${fixtureId}-notification` },
      include: { recipients: true },
    })).resolves.toMatchObject({
      title: "迁移通知",
      targetRole: "EXPERT",
      recipients: [expect.objectContaining({
        id: `${fixtureId}-recipient`,
        userId: `${fixtureId}-user`,
        acknowledgedAt: expect.any(Date),
      })],
    });
  });
});
