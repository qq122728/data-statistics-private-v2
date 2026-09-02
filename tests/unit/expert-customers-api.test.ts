import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/expert/customers/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "expert-customers-api-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const id = (value: string) => `expert-api-${value}-${suffix}`;
const ids = {
  group: id("group"), otherGroup: id("other-group"), expert: id("expert"), peer: id("peer"), reception: id("reception"), lead: id("lead"),
  channel: id("channel"), otherChannel: id("other-channel"), batch: id("batch"), otherBatch: id("other-batch"), ordered: id("ordered"),
};

beforeAll(async () => {
  await db.teamGroup.createMany({ data: [{ id: ids.group, name: "专家一组" }, { id: ids.otherGroup, name: "专家二组" }] });
  await db.user.createMany({ data: [
    { id: ids.expert, username: ids.expert, name: "专家本人", role: "EXPERT", groupId: ids.group },
    { id: ids.peer, username: ids.peer, name: "同组专家", role: "EXPERT", groupId: ids.group },
    { id: ids.reception, username: ids.reception, name: "本组接粉", role: "RECEPTION", groupId: ids.group },
    { id: ids.lead, username: ids.lead, name: "本组组长", role: "LEAD", groupId: ids.group },
  ] });
  await db.channel.createMany({ data: [
    { id: ids.channel, groupId: ids.group, name: "专家渠道", normalizedName: "专家渠道" },
    { id: ids.otherChannel, groupId: ids.otherGroup, name: "外组渠道", normalizedName: "外组渠道" },
  ] });
  await db.sourceBatch.createMany({ data: [
    { id: ids.batch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-29" },
    { id: ids.otherBatch, groupId: ids.otherGroup, channelId: ids.otherChannel, sourceDate: "2026-08-29" },
  ] });
  await db.leadCustomer.createMany({ data: [
    { id: id("queued"), phone: "492000000001", customerName: "本人排队客户", batchId: ids.batch, ownerId: ids.reception, expertOwnerId: ids.expert, groupStatus: "JOINED", joinedOn: "2026-08-20", expertIntroducedOn: "2026-08-29" },
    { id: id("pending-order"), phone: "492000000002", customerName: "本人待开单", batchId: ids.batch, ownerId: ids.reception, expertOwnerId: ids.expert, groupStatus: "JOINED", joinedOn: "2026-08-20", expertIntroducedOn: "2026-08-27", expertWorkflowStage: "PENDING_ORDER", registeredOn: "2026-08-29" },
    { id: ids.ordered, phone: "492000000003", customerName: "本人已开单", batchId: ids.batch, ownerId: ids.reception, expertOwnerId: ids.expert, groupStatus: "JOINED", joinedOn: "2026-08-20", expertIntroducedOn: "2026-08-20", expertWorkflowStage: "ORDERED", registeredOn: "2026-08-25" },
    { id: id("peer"), phone: "492000000004", batchId: ids.batch, ownerId: ids.reception, expertOwnerId: ids.peer, groupStatus: "JOINED", joinedOn: "2026-08-20", expertIntroducedOn: "2026-08-29" },
    { id: id("invalid"), phone: "492000000005", batchId: ids.batch, ownerId: ids.reception, expertOwnerId: ids.expert, groupStatus: "JOINED", joinedOn: "2026-08-20", expertIntroducedOn: "2026-08-29", invalid: true },
    { id: id("pending-history"), phone: "492000000006", batchId: ids.batch, ownerId: ids.reception, expertOwnerId: ids.expert, groupStatus: "JOINED", joinedOn: "2026-08-20", expertIntroducedOn: "2026-08-29", isHistoricalRecord: true, historicalReviewStatus: "PENDING" },
    { id: id("other-group"), phone: "492000000007", batchId: ids.otherBatch, ownerId: ids.reception, expertOwnerId: ids.expert, groupStatus: "JOINED", joinedOn: "2026-08-20", expertIntroducedOn: "2026-08-29" },
  ] });
  const order = await db.customerOrder.create({ data: {
    id: id("order"), phone: "492000000003", batchId: ids.batch, enteredById: ids.expert,
    openedOn: "2026-08-29", initialDepositCents: 114800, initialDepositMethod: "CRYPTO", leadId: ids.ordered,
  } });
  await db.customerFinanceEvent.createMany({ data: [
    { id: id("recharge"), batchId: ids.batch, enteredById: ids.expert, occurredOn: "2026-08-29", kind: "RECHARGE", amountCents: 10000, depositMethod: "CRYPTO", customerOrderId: order.id, continuationNumber: 1 },
    { id: id("withdrawal"), batchId: ids.batch, enteredById: ids.expert, occurredOn: "2026-08-29", kind: "WITHDRAWAL", amountCents: 5000, customerOrderId: order.id },
  ] });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.$disconnect();
  if (isolatedDatabase.directory) {
    const { rm } = await import("node:fs/promises");
    await rm(isolatedDatabase.directory, { recursive: true, force: true });
  }
});

async function signIn(userId: string) {
  vi.restoreAllMocks();
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { roleAssignments: { select: { role: true } } } });
  vi.spyOn(auth, "requireUser").mockResolvedValue(user as auth.SessionUser);
}

const request = (query = "") => new Request(`http://localhost/api/expert/customers?${query}`);

describe.sequential("本组专家流程客户 API", () => {
  it("普通专家只返回有配合关系的专家客户，并提供阶段与资金摘要", async () => {
    await signIn(ids.expert);
    const all = await (await GET(request())).json();
    const ordered = await (await GET(request("stage=ORDERED&q=已开单"))).json();

    expect(all.counts).toEqual({ QUEUED: 1, MATERIALS: 0, TRACKING: 0, PENDING_REGISTRATION: 0, PENDING_ORDER: 1, DECLINED_DEPOSIT: 0, ORDERED: 1, STALLED: 0 });
    expect(new Set(all.customers.map((customer: { phone: string }) => customer.phone))).toEqual(new Set(["492000000001", "492000000002", "492000000003"]));
    expect(all.customers.find((customer: { phone: string }) => customer.phone === "492000000001")).toMatchObject({ canEdit: true });
    expect(all.customers.find((customer: { phone: string }) => customer.phone === "492000000004")).toBeUndefined();
    expect(ordered.customers[0]).toMatchObject({
      id: ids.ordered, phone: "492000000003", stage: "ORDERED",
      order: { initialDepositCents: 114800, rechargeCents: 10000, withdrawalCents: 5000, netDepositCents: 119800, nextContinuationNumber: 2 },
    });
    expect(JSON.stringify([all, ordered])).not.toMatch(/49200000000[5-7]/);
  });

  it("组长读取本组全部专家客户，原接粉人读取自己参与的客户", async () => {
    await signIn(ids.lead);
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ total: 4 });
    await signIn(ids.reception);
    const memberResponse = await GET(request());
    expect(memberResponse.status).toBe(200);
    await expect(memberResponse.json()).resolves.toMatchObject({ total: 4 });
  });
});
