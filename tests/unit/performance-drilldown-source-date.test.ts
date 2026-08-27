import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAnalyticsTestDatabase } from "./helpers/analytics-db";

const temporaryDatabase = await createAnalyticsTestDatabase("performance-drilldown-source-date");
const originalDatabaseUrl = process.env.DATABASE_URL;
const suffix = randomUUID();
const ids = {
  group: `performance-drilldown-group-${suffix}`,
  channel: `performance-drilldown-channel-${suffix}`,
  receptionist: `performance-drilldown-receptionist-${suffix}`,
  operator: `performance-drilldown-operator-${suffix}`,
  expert: `performance-drilldown-expert-${suffix}`,
};

let db: any;
let loadGroupOperatorCustomerPage: typeof import("../../src/lib/customer-queries/group-customers").loadGroupOperatorCustomerPage;
let loadExpertPendingCustomerPage: typeof import("../../src/lib/customer-queries/expert-customers").loadExpertPendingCustomerPage;

const dates = ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"];

beforeAll(async () => {
  process.env.DATABASE_URL = temporaryDatabase.databaseUrl;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.resetModules();
  ({ db } = await import("../../src/lib/db"));
  ({ loadGroupOperatorCustomerPage } = await import("../../src/lib/customer-queries/group-customers"));
  ({ loadExpertPendingCustomerPage } = await import("../../src/lib/customer-queries/expert-customers"));

  await db.teamGroup.create({ data: { id: ids.group, name: "日期筛选组" } });
  await db.channel.create({ data: { id: ids.channel, groupId: ids.group, name: "日期筛选渠道", normalizedName: "日期筛选渠道" } });
  await db.user.createMany({ data: [
    { id: ids.receptionist, username: ids.receptionist, name: "接粉员", passwordHash: "test", role: "RECEPTION", groupId: ids.group },
    { id: ids.operator, username: ids.operator, name: "炒群员", passwordHash: "test", role: "GROUP_OPERATOR", groupId: ids.group },
    { id: ids.expert, username: ids.expert, name: "专家", passwordHash: "test", role: "EXPERT", groupId: ids.group },
  ] });
  await db.groupOperatorReception.create({ data: { groupOperatorId: ids.operator, receptionistId: ids.receptionist } });

  for (const [index, sourceDate] of dates.entries()) {
    const batch = await db.sourceBatch.create({ data: { groupId: ids.group, channelId: ids.channel, sourceDate } });
    await db.leadCustomer.createMany({ data: [
      {
        phone: `181${String(index).padStart(8, "0")}`,
        customerName: `炒群 ${sourceDate}`,
        batchId: batch.id,
        ownerId: ids.receptionist,
        groupStatus: "JOINED",
      },
      {
        phone: `182${String(index).padStart(8, "0")}`,
        customerName: `专家 ${sourceDate}`,
        batchId: batch.id,
        ownerId: ids.receptionist,
        expertOwnerId: ids.expert,
        expertIntroducedOn: "2026-08-15",
        expertContactedOn: "2026-08-16",
      },
    ] });
  }
});

afterAll(async () => {
  await db?.$disconnect();
  delete (globalThis as { prisma?: unknown }).prisma;
  process.env.DATABASE_URL = originalDatabaseUrl;
  await temporaryDatabase.cleanup();
});

describe.sequential("performance drilldown source-date filtering", () => {
  it("limits group-operator pending customers to the inclusive source-date range", async () => {
    const page = await loadGroupOperatorCustomerPage({
      groupId: ids.group,
      operatorId: ids.operator,
      kind: "pending",
      from: "2026-08-10",
      to: "2026-08-12",
      query: "",
      page: 1,
      pageSize: 20,
    });

    expect(page?.customers.map((customer) => customer.sourceDate).sort()).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(page?.total).toBe(3);
  });

  it("limits expert pending-registration customers to the inclusive source-date range", async () => {
    const page = await loadExpertPendingCustomerPage({
      groupId: ids.group,
      expertId: ids.expert,
      kind: "registration",
      from: "2026-08-10",
      to: "2026-08-12",
      query: "",
      page: 1,
      pageSize: 20,
    });

    expect(page?.customers.map((customer) => customer.source.split(" · ")[0]).sort()).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(page?.total).toBe(3);
  });
});
