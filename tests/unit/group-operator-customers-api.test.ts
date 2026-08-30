import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/group-operator/customers/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "group-operator-customers-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const id = (value: string) => `group-workbench-${value}-${suffix}`;
const ids = {
  group: id("group"), otherGroup: id("other-group"), operator: id("operator"), peerOperator: id("peer-operator"),
  reception: id("reception"), peerReception: id("peer-reception"), expert: id("expert"), lead: id("lead"),
  channel: id("channel"), otherChannel: id("other-channel"), batch: id("batch"), otherBatch: id("other-batch"),
};

beforeAll(async () => {
  await db.teamGroup.createMany({ data: [{ id: ids.group, name: "炒群一组" }, { id: ids.otherGroup, name: "炒群二组" }] });
  await db.user.createMany({ data: [
    { id: ids.operator, username: ids.operator, name: "炒群本人", role: "GROUP_OPERATOR", groupId: ids.group },
    { id: ids.peerOperator, username: ids.peerOperator, name: "同组炒群", role: "GROUP_OPERATOR", groupId: ids.group },
    { id: ids.reception, username: ids.reception, name: "配对接粉", role: "RECEPTION", groupId: ids.group },
    { id: ids.peerReception, username: ids.peerReception, name: "其他接粉", role: "RECEPTION", groupId: ids.group },
    { id: ids.expert, username: ids.expert, name: "本组专家", role: "EXPERT", groupId: ids.group },
    { id: ids.lead, username: ids.lead, name: "本组组长", role: "LEAD", groupId: ids.group },
  ] });
  await db.groupOperatorReception.createMany({ data: [
    { groupOperatorId: ids.operator, receptionistId: ids.reception },
    { groupOperatorId: ids.peerOperator, receptionistId: ids.peerReception },
  ] });
  await db.channel.createMany({ data: [
    { id: ids.channel, groupId: ids.group, name: "本组渠道", normalizedName: "本组渠道" },
    { id: ids.otherChannel, groupId: ids.otherGroup, name: "外组渠道", normalizedName: "外组渠道" },
  ] });
  await db.sourceBatch.createMany({ data: [
    { id: ids.batch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-29" },
    { id: ids.otherBatch, groupId: ids.otherGroup, channelId: ids.otherChannel, sourceDate: "2026-08-29" },
  ] });
  await db.leadCustomer.createMany({ data: [
    { id: id("fallback"), phone: "491000000001", customerName: "当前配对归本人", batchId: ids.batch, ownerId: ids.reception, groupStatus: "JOINED", joinedOn: "2026-08-28" },
    { id: id("recent-action"), phone: "491000000002", customerName: "最近推专家归本人", batchId: ids.batch, ownerId: ids.peerReception, groupStatus: "JOINED", joinedOn: "2026-08-27", expertIntroducedOn: "2026-08-29", expertOwnerId: ids.expert },
    { id: id("explicit-left"), phone: "491000000003", customerName: "明确归属已退群", batchId: ids.batch, ownerId: ids.peerReception, groupOperatorOwnerId: ids.operator, groupStatus: "LEFT", joinedOn: "2026-08-20", leftOn: "2026-08-29" },
    { id: id("peer"), phone: "491000000004", batchId: ids.batch, ownerId: ids.reception, groupOperatorOwnerId: ids.peerOperator, groupStatus: "JOINED", joinedOn: "2026-08-28" },
    { id: id("invalid"), phone: "491000000005", batchId: ids.batch, ownerId: ids.reception, groupOperatorOwnerId: ids.operator, groupStatus: "JOINED", invalid: true },
    { id: id("pending-history"), phone: "491000000006", batchId: ids.batch, ownerId: ids.reception, groupOperatorOwnerId: ids.operator, groupStatus: "JOINED", isHistoricalRecord: true, historicalReviewStatus: "PENDING" },
    { id: id("other-group"), phone: "491000000007", batchId: ids.otherBatch, ownerId: ids.reception, groupOperatorOwnerId: ids.operator, groupStatus: "JOINED" },
  ] });
  await db.leadActivity.create({ data: { leadId: id("recent-action"), actorId: ids.operator, kind: "EXPERT_INTRODUCED", occurredOn: "2026-08-29" } });
  await db.leadActivity.create({ data: { leadId: id("fallback"), actorId: ids.operator, kind: "GROUP_PROGRESS_UPDATED", occurredOn: "2026-08-29", note: "客户正在群内了解资料" } });
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

const request = (query = "") => new Request(`http://localhost/api/group-operator/customers?${query}`);

describe.sequential("新版炒群本人客户 API", () => {
  it("按三层归属只返回本人当前小组客户，并排除无效与待审核历史数据", async () => {
    await signIn(ids.operator);
    const active = await (await GET(request("stage=active&q=归本人"))).json();
    const introduced = await (await GET(request("stage=introduced"))).json();
    const left = await (await GET(request("stage=left"))).json();

    expect(active.customers.map((customer: { phone: string }) => customer.phone)).toEqual(["491000000001"]);
    expect(active.customers[0].latestGroupProgress).toMatchObject({ note: "客户正在群内了解资料", actor: { id: ids.operator } });
    expect(introduced.counts).toEqual({ active: 1, introduced: 1, left: 1 });
    expect(introduced.expertAssignees).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.expert, name: "本组专家" }),
      expect.objectContaining({ id: ids.lead, name: "本组组长" }),
    ]));
    expect(introduced.customers[0]).toMatchObject({ phone: "491000000002", stage: "introduced", expertOwner: { id: ids.expert } });
    expect(left.customers[0]).toMatchObject({ phone: "491000000003", stage: "left", groupOperatorOwnerId: ids.operator });
    expect(JSON.stringify([active, introduced, left])).not.toMatch(/49100000000[4-7]/);
  });

  it("非炒群账号不能借本人接口查看客户", async () => {
    await signIn(ids.lead);
    expect((await GET(request())).status).toBe(403);
  });
});
