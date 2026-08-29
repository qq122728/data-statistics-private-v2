import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/reception/customers/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "reception-customers-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const id = (value: string) => `reception-api-${value}-${suffix}`;
const ids = {
  company: id("company"), department: id("department"), group: id("group"), otherGroup: id("other-group"),
  reception: id("reception"), peer: id("peer"), other: id("other"), lead: id("lead"), operator: id("operator"),
  channel: id("channel"), otherChannel: id("other-channel"), batch: id("batch"), otherBatch: id("other-batch"),
};

beforeAll(async () => {
  await db.company.create({ data: { id: ids.company, name: `接粉接口公司-${suffix}` } });
  await db.department.create({ data: { id: ids.department, name: `接粉接口部门-${suffix}`, companyId: ids.company, countryCode: "DE", timezone: "Europe/Berlin" } });
  await db.teamGroup.createMany({ data: [
    { id: ids.group, name: `接粉接口一组-${suffix}`, departmentId: ids.department },
    { id: ids.otherGroup, name: `接粉接口二组-${suffix}`, departmentId: ids.department },
  ] });
  await db.user.createMany({ data: [
    { id: ids.reception, username: ids.reception, name: "接粉本人", role: "RECEPTION", groupId: ids.group },
    { id: ids.peer, username: ids.peer, name: "同组接粉", role: "RECEPTION", groupId: ids.group },
    { id: ids.other, username: ids.other, name: "其它组接粉", role: "RECEPTION", groupId: ids.otherGroup },
    { id: ids.lead, username: ids.lead, name: "本组组长", role: "LEAD", duty: "LEAD", groupId: ids.group },
    { id: ids.operator, username: ids.operator, name: "配对炒群", role: "GROUP_OPERATOR", groupId: ids.group },
  ] });
  await db.groupOperatorReception.create({ data: { receptionistId: ids.reception, groupOperatorId: ids.operator } });
  await db.channel.createMany({ data: [
    { id: ids.channel, groupId: ids.group, name: "本人渠道", normalizedName: "本人渠道" },
    { id: ids.otherChannel, groupId: ids.otherGroup, name: "其它渠道", normalizedName: "其它渠道" },
  ] });
  await db.sourceBatch.createMany({ data: [
    { id: ids.batch, groupId: ids.group, channelId: ids.channel, sourceDate: "2026-08-29" },
    { id: ids.otherBatch, groupId: ids.otherGroup, channelId: ids.otherChannel, sourceDate: "2026-08-29" },
  ] });
  await db.leadCustomer.createMany({ data: [
    { id: id("reply"), phone: "491111111111", batchId: ids.batch, ownerId: ids.reception },
    { id: id("join"), phone: "492222222222", customerName: "待进群客户", batchId: ids.batch, ownerId: ids.reception, repliedOn: "2026-08-29", replyStatus: "REPLIED" },
    { id: id("auto-archive"), phone: "493333333333", batchId: ids.batch, ownerId: ids.reception, followUpCount: 5 },
    { id: id("manual-archive"), phone: "494444444444", batchId: ids.batch, ownerId: ids.reception, repliedOn: "2026-08-28", replyStatus: "REPLIED", receptionArchivedAt: new Date("2026-08-29T12:00:00Z") },
    { id: id("invalid"), phone: "497777777777", batchId: ids.batch, ownerId: ids.reception, invalid: true, receptionCategory: "INVALID" },
    { id: id("peer"), phone: "495555555555", batchId: ids.batch, ownerId: ids.peer },
    { id: id("other"), phone: "496666666666", batchId: ids.otherBatch, ownerId: ids.other },
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

const request = (query = "") => new Request(`http://localhost/api/reception/customers?${query}`);

describe.sequential("新版接粉本人客户 API", () => {
  it("只返回本人名单，并把待回复、待入群和归档分开", async () => {
    await signIn(ids.reception);
    const reply = await (await GET(request("stage=reply"))).json();
    const group = await (await GET(request("stage=group&q=待进群"))).json();
    const archived = await (await GET(request("stage=archived"))).json();

    expect(reply.counts).toEqual({ reply: 1, group: 1, archived: 2 });
    expect(reply.currentGroupOperator).toEqual({ id: ids.operator, name: "配对炒群" });
    expect(reply.customers.map((customer: { phone: string }) => customer.phone)).toEqual(["491111111111"]);
    expect(group.customers).toHaveLength(1);
    expect(group.customers[0]).toMatchObject({ phone: "492222222222", customerName: "待进群客户" });
    expect(new Set(archived.customers.map((customer: { phone: string }) => customer.phone))).toEqual(new Set(["493333333333", "494444444444"]));
    expect(JSON.stringify([reply, group, archived])).not.toContain("495555555555");
    expect(JSON.stringify([reply, group, archived])).not.toContain("496666666666");
    expect(JSON.stringify([reply, group, archived])).not.toContain("497777777777");
  });

  it("组长不能借接粉本人接口读取号码", async () => {
    await signIn(ids.lead);
    expect((await GET(request())).status).toBe(403);
  });
});
