import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db";
import { loadGroupCustomerWorkspace } from "../../src/lib/customer-queries/group-customers";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "group-customer-in-group-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const ids = {
  group: `snapshot-group-${suffix}`,
  channel: `snapshot-channel-${suffix}`,
  reception: `snapshot-reception-${suffix}`,
  operator: `snapshot-operator-${suffix}`,
  oldBatch: `snapshot-old-batch-${suffix}`,
  recentBatch: `snapshot-recent-batch-${suffix}`,
};

beforeAll(async () => {
  await db.teamGroup.create({ data: { id: ids.group, name: "在群快照测试组" } });
  await db.channel.create({ data: { id: ids.channel, groupId: ids.group, name: "快照渠道", normalizedName: "快照渠道" } });
  await db.user.create({ data: { id: ids.reception, username: `snapshot-reception-${suffix}`, name: "快照接粉员", passwordHash: "test", role: "RECEPTION", groupId: ids.group } });
  await db.user.create({ data: { id: ids.operator, username: `snapshot-operator-${suffix}`, name: "快照组长", passwordHash: "test", role: "GROUP_OPERATOR", groupId: ids.group } });
  await db.sourceBatch.create({ data: { id: ids.oldBatch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-07-01" } });
  await db.sourceBatch.create({ data: { id: ids.recentBatch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-20" } });
  await db.leadCustomer.create({
    data: {
      id: `snapshot-old-lead-${suffix}`,
      phone: `snapshot-old-phone-${suffix}`,
      batchId: ids.oldBatch,
      ownerId: ids.reception,
      groupOperatorOwnerId: ids.operator,
      groupStatus: "JOINED",
      joinedOn: "2026-07-01",
    },
  });
  await db.leadCustomer.create({
    data: {
      id: `snapshot-recent-lead-${suffix}`,
      phone: `snapshot-recent-phone-${suffix}`,
      batchId: ids.recentBatch,
      ownerId: ids.reception,
      groupOperatorOwnerId: ids.operator,
      groupStatus: "JOINED",
      joinedOn: "2026-08-20",
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe("炒群工作台在群人数快照", () => {
  it("当前在群不受报表选中的 sourceDate 范围卡人群——早于范围到店、还没退群的客户照样算", async () => {
    const common = {
      groupIds: [ids.group], userId: ids.operator, isLead: true, isGroupOperator: false,
      isReceptionist: false, query: "", skip: 0, take: 50, view: "inGroup" as const,
    };
    const [wide, narrow] = await Promise.all([
      loadGroupCustomerWorkspace({ ...common }),
      loadGroupCustomerWorkspace({ ...common, sourceDate: { gte: "2026-08-01", lte: "2026-08-31" } }),
    ]);

    const wideRow = wide.performanceSummary.find((row) => row.operatorId === ids.operator);
    const narrowRow = narrow.performanceSummary.find((row) => row.operatorId === ids.operator);
    expect(wideRow?.inGroup).toBe(2);
    expect(narrowRow?.inGroup).toBe(2);
  });
});
