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
  const directory = mkdtempSync(join(tmpdir(), "group-customer-stage-"));
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
  group: `stage-group-${suffix}`,
  channel: `stage-channel-${suffix}`,
  channelTwo: `stage-channel-two-${suffix}`,
  user: `stage-user-${suffix}`,
  userTwo: `stage-user-two-${suffix}`,
  batch: `stage-batch-${suffix}`,
  batchTwo: `stage-batch-two-${suffix}`,
};

beforeAll(async () => {
  await db.teamGroup.create({ data: { id: ids.group, name: "分页测试组" } });
  await db.channel.create({ data: { id: ids.channel, groupId: ids.group, name: "分页测试渠道", normalizedName: "分页测试渠道" } });
  await db.channel.create({ data: { id: ids.channelTwo, groupId: ids.group, name: "后页渠道", normalizedName: "后页渠道" } });
  await db.user.create({ data: { id: ids.user, username: `stage-${suffix}`, name: "测试管理员", passwordHash: "test", role: "ADMIN" } });
  await db.user.create({ data: { id: ids.userTwo, username: `stage-two-${suffix}`, name: "后页接粉员", passwordHash: "test", role: "RECEPTION", groupId: ids.group } });
  await db.sourceBatch.create({ data: { id: ids.batch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-26" } });
  await db.sourceBatch.create({ data: { id: ids.batchTwo, groupId: ids.group, channelId: ids.channelTwo, sourceDate: "2026-08-26" } });
  await db.leadCustomer.createMany({
    data: Array.from({ length: 53 }, (_, index) => ({
      id: `stage-lead-${index}-${suffix}`,
      phone: `stage-phone-${index}-${suffix}`,
      batchId: index >= 50 ? ids.batchTwo : ids.batch,
      ownerId: index >= 50 ? ids.userTwo : ids.user,
      groupStatus: index === 52 ? "LEFT" : "JOINED",
      joinedOn: "2026-08-01",
      leftOn: index === 52 ? "2026-08-20" : null,
      expertIntroducedOn: "2026-08-02",
      expertWorkflowStage: index >= 50 ? "ORDERED" : "QUEUED",
    })),
  });
  await db.leadCustomer.createMany({
    data: Array.from({ length: 52 }, (_, index) => ({
      id: `stage-progress-${index}-${suffix}`,
      phone: `stage-progress-phone-${index}-${suffix}`,
      batchId: ids.batch,
      ownerId: ids.user,
      groupStatus: "JOINED",
      joinedOn: index >= 50 ? "2026-07-01" : "2026-08-01",
      expertIntroducedOn: "2026-08-02",
      expertWorkflowStage: index >= 50 ? "MATERIALS" : "TRACKING",
    })),
  });
  await db.customerOrder.createMany({
    data: Array.from({ length: 3 }, (_, offset) => {
      const index = 50 + offset;
      return {
        phone: `stage-phone-${index}-${suffix}`,
        batchId: ids.batchTwo,
        enteredById: ids.user,
        leadId: `stage-lead-${index}-${suffix}`,
        openedOn: "2026-08-26",
        initialDepositCents: 10000,
      };
    }),
  });
});

afterAll(async () => {
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

describe("炒群明细服务端阶段筛选", () => {
  it("先筛已开单再分页，不会漏掉原本排在第 50 条之后的客户", async () => {
    const workspace = await loadGroupCustomerWorkspace({
      groupIds: [ids.group],
      userId: ids.user,
      isLead: false,
      isGroupOperator: false,
      isReceptionist: false,
      query: "",
      skip: 0,
      take: 50,
      view: "ordered",
    });

    expect(workspace.totalCustomers).toBe(105);
    expect(workspace.filteredTotal).toBe(3);
    expect(workspace.viewCounts.ordered).toBe(3);
    expect(workspace.customers).toHaveLength(3);
  });

  it("退群且已开单的客户同时出现在已退群和已开单视图", async () => {
    const common = {
      groupIds: [ids.group], userId: ids.user, isLead: false, isGroupOperator: false,
      isReceptionist: false, query: "", skip: 0, take: 50,
    };
    const [ordered, left] = await Promise.all([
      loadGroupCustomerWorkspace({ ...common, view: "ordered" }),
      loadGroupCustomerWorkspace({ ...common, view: "left" }),
    ]);

    const leftOrderedId = `stage-lead-52-${suffix}`;
    expect(ordered.customers.some((customer) => customer.id === leftOrderedId)).toBe(true);
    expect(left.customers.some((customer) => customer.id === leftOrderedId)).toBe(true);
  });

  it("接粉人员和渠道筛选会在分页前查找完整数据", async () => {
    const workspace = await loadGroupCustomerWorkspace({
      groupIds: [ids.group], userId: ids.user, isLead: false, isGroupOperator: false,
      isReceptionist: false, query: "", skip: 0, take: 50, view: "ordered",
      member: "后页接粉员", channel: "后页渠道",
    });

    expect(workspace.filteredTotal).toBe(3);
    expect(workspace.customers).toHaveLength(3);
    expect(workspace.filterOptions.members).toContain("后页接粉员");
    expect(workspace.filterOptions.channels).toContain("后页渠道");
  });

  it("具体专家阶段会先筛完整数据再分页", async () => {
    const workspace = await loadGroupCustomerWorkspace({
      groupIds: [ids.group], userId: ids.user, isLead: false, isGroupOperator: false,
      isReceptionist: false, query: "", skip: 0, take: 50, view: "expertProgress",
      expertStage: "MATERIALS",
    });

    expect(workspace.filteredTotal).toBe(2);
    expect(workspace.customers).toHaveLength(2);
    expect(workspace.customers.every((customer) => customer.expertWorkflowStage === "MATERIALS")).toBe(true);
  });

  it("退群时间和退群开单结果会在分页前共同筛选", async () => {
    const workspace = await loadGroupCustomerWorkspace({
      groupIds: [ids.group], userId: ids.user, isLead: false, isGroupOperator: false,
      isReceptionist: false, query: "", skip: 0, take: 50, view: "left",
      leaveRisk: "NORMAL", leaveOrder: "ordered",
    });

    expect(workspace.filteredTotal).toBe(1);
    expect(workspace.customers[0]?.id).toBe(`stage-lead-52-${suffix}`);
  });
});
