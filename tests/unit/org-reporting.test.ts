import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET as getOrgReporting } from "../../src/app/api/org/reporting/route";
import { GET as getLeadChannelReporting } from "../../src/app/api/lead/channel-reporting/route";
import { GET as getLeadCustomerReporting } from "../../src/app/api/lead/customer-reporting/route";

const isolatedDatabase = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../src/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { execFileSync } = await import("node:child_process");
  const { closeSync, mkdtempSync, openSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "org-reporting-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
  });
  isolatedDatabase.directory = directory;
  return { db: new PrismaClient({ datasourceUrl: `file:${databasePath}` }) };
});

const suffix = randomUUID();
const id = (value: string) => `org-reporting-${value}-${suffix}`;
const ids = {
  companyA: id("company-a"), companyB: id("company-b"),
  berlinDept: id("berlin-dept"), newYorkDept: id("new-york-dept"), otherDept: id("other-dept"),
  berlinGroup: id("berlin-group"), newYorkGroup: id("new-york-group"), otherGroup: id("other-group"),
  berlinReception: id("berlin-reception"), newYorkReception: id("new-york-reception"), otherReception: id("other-reception"),
  lead: id("lead"), departmentManager: id("department-manager"), companyManager: id("company-manager"),
  hqManager: id("hq-manager"), resource: id("resource"),
};

beforeAll(async () => {
  await db.company.createMany({ data: [
    { id: ids.companyA, name: `报表公司A-${suffix}` },
    { id: ids.companyB, name: `报表公司B-${suffix}` },
  ] });
  await db.department.createMany({ data: [
    { id: ids.berlinDept, name: `柏林部门-${suffix}`, companyId: ids.companyA, countryCode: "DE", timezone: "Europe/Berlin" },
    { id: ids.newYorkDept, name: `纽约部门-${suffix}`, companyId: ids.companyA, countryCode: "US", timezone: "America/New_York" },
    { id: ids.otherDept, name: `其它公司部门-${suffix}`, companyId: ids.companyB, countryCode: "SG", timezone: "Asia/Singapore" },
  ] });
  await db.teamGroup.createMany({ data: [
    { id: ids.berlinGroup, name: `柏林一组-${suffix}`, departmentId: ids.berlinDept },
    { id: ids.newYorkGroup, name: `纽约一组-${suffix}`, departmentId: ids.newYorkDept },
    { id: ids.otherGroup, name: `其它一组-${suffix}`, departmentId: ids.otherDept },
  ] });
  await db.user.createMany({ data: [
    { id: ids.berlinReception, username: ids.berlinReception, name: "柏林接粉", role: "RECEPTION", groupId: ids.berlinGroup },
    { id: ids.newYorkReception, username: ids.newYorkReception, name: "纽约接粉", role: "RECEPTION", groupId: ids.newYorkGroup },
    { id: ids.otherReception, username: ids.otherReception, name: "其它接粉", role: "RECEPTION", groupId: ids.otherGroup },
    { id: ids.lead, username: ids.lead, name: "柏林组长", role: "LEAD", duty: "LEAD", groupId: ids.berlinGroup },
    { id: ids.departmentManager, username: ids.departmentManager, name: "柏林部门管理员", role: "COMPANY_MANAGER", duty: "DEPARTMENT_MANAGER", departmentId: ids.berlinDept },
    { id: ids.companyManager, username: ids.companyManager, name: "A公司管理员", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: ids.companyA },
    { id: ids.hqManager, username: ids.hqManager, name: "总公司管理员", role: "COMPANY_MANAGER", duty: "HQ_MANAGER" },
    { id: ids.resource, username: ids.resource, name: "资源部", role: "RESOURCE_MANAGER", duty: "RESOURCE_MANAGER" },
  ] });
  await db.channel.createMany({ data: [
    { id: id("berlin-channel"), groupId: ids.berlinGroup, name: "柏林渠道", normalizedName: "柏林渠道" },
    { id: id("new-york-channel"), groupId: ids.newYorkGroup, name: "纽约渠道", normalizedName: "纽约渠道" },
    { id: id("other-channel"), groupId: ids.otherGroup, name: "其它渠道", normalizedName: "其它渠道" },
  ] });
  const [berlinBatch, newYorkBatch, otherBatch] = await Promise.all([
    db.sourceBatch.create({ data: { groupId: ids.berlinGroup, channelId: id("berlin-channel"), sourceDate: "2026-09-01" } }),
    db.sourceBatch.create({ data: { groupId: ids.newYorkGroup, channelId: id("new-york-channel"), sourceDate: "2026-08-31" } }),
    db.sourceBatch.create({ data: { groupId: ids.otherGroup, channelId: id("other-channel"), sourceDate: "2026-09-01" } }),
  ]);
  await db.metricEvent.createMany({ data: [
    { batchId: berlinBatch.id, enteredById: ids.berlinReception, occurredOn: "2026-09-01", kind: "NEW_FANS", quantity: 3 },
    { batchId: berlinBatch.id, enteredById: ids.berlinReception, occurredOn: "2026-09-01", kind: "EFFECTIVE_FANS", quantity: 2 },
    { batchId: berlinBatch.id, enteredById: ids.berlinReception, occurredOn: "2026-09-01", kind: "REPLIES", quantity: 1 },
    { batchId: newYorkBatch.id, enteredById: ids.newYorkReception, occurredOn: "2026-08-31", kind: "NEW_FANS", quantity: 4 },
    { batchId: otherBatch.id, enteredById: ids.otherReception, occurredOn: "2026-09-01", kind: "NEW_FANS", quantity: 9 },
  ] });
});

afterAll(async () => {
  vi.useRealTimers(); vi.restoreAllMocks(); await db.$disconnect();
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

const request = (query = "range=today") => new Request(`http://localhost/api/org/reporting?${query}`);

describe.sequential("新版组织范围真实报表 API", () => {
  it("公司管理员只看到本公司，并按每个小组当地今天取同一口径的汇总与人员", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.companyManager);
    const response = await getOrgReporting(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.groups.map((group: { id: string }) => group.id)).toEqual([ids.berlinGroup, ids.newYorkGroup]);
    expect(body.groups.find((group: { id: string }) => group.id === ids.berlinGroup)).toMatchObject({
      period: { today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" },
      totals: { added: 3, effective: 2, replied: 1 },
    });
    expect(body.groups.find((group: { id: string }) => group.id === ids.newYorkGroup)).toMatchObject({
      period: { today: "2026-08-31", from: "2026-08-31", to: "2026-08-31" },
      totals: { added: 4 },
    });
    expect(new Set(body.members.map((member: { id: string }) => member.id))).toEqual(new Set([ids.berlinReception, ids.newYorkReception]));
  });

  it("部门管理员和组长只能读取自己的范围，伪造其它小组会返回403", async () => {
    await signIn(ids.departmentManager);
    const department = await getOrgReporting(request());
    expect((await department.json()).groups.map((group: { id: string }) => group.id)).toEqual([ids.berlinGroup]);
    expect((await getOrgReporting(request(`range=today&groupId=${ids.newYorkGroup}`))).status).toBe(403);

    await signIn(ids.lead);
    const lead = await getOrgReporting(request());
    expect((await lead.json()).groups.map((group: { id: string }) => group.id)).toEqual([ids.berlinGroup]);
  });

  it("总公司管理员能看到全部公司，资源部账号不能借这个接口查看组织业绩", async () => {
    await signIn(ids.hqManager);
    const hq = await getOrgReporting(request());
    expect(new Set((await hq.json()).groups.map((group: { id: string }) => group.id))).toEqual(new Set([ids.berlinGroup, ids.newYorkGroup, ids.otherGroup]));

    await signIn(ids.resource);
    expect((await getOrgReporting(request())).status).toBe(403);
  });
});

describe.sequential("新版组长真实渠道报表 API", () => {
  it("组长只能读取自己的渠道，并按本组当地日期计算今日", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.lead);
    const response = await getLeadChannelReporting(new Request("http://localhost/api/lead/channel-reporting?range=today"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.group).toMatchObject({ id: ids.berlinGroup, timezone: "Europe/Berlin" });
    expect(body.range).toMatchObject({ today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ name: "柏林渠道", totals: { added: 3, effective: 2, replied: 1 } });
  });

  it("非组长不能借该接口读取渠道明细", async () => {
    await signIn(ids.departmentManager);
    expect((await getLeadChannelReporting(new Request("http://localhost/api/lead/channel-reporting?range=month"))).status).toBe(403);
  });
});

describe.sequential("新版组长真实客户进度 API", () => {
  it("按接粉、炒群、专家阶段读取本组真实客户并返回分页数量", async () => {
    await db.leadCustomer.createMany({ data: [
      { id: id("customer-pending-reply"), phone: `40${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception },
      { id: id("customer-reception"), phone: `41${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, repliedOn: "2026-07-02", replyStatus: "REPLIED" },
      { id: id("customer-archived"), phone: `44${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, repliedOn: "2026-07-02", replyStatus: "REPLIED", receptionArchivedAt: new Date("2026-07-05T12:00:00Z"), receptionArchiveReason: "历史归档", receptionArchiveVisitCount: 2 },
      { id: id("customer-group"), phone: `42${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, repliedOn: "2026-07-02", replyStatus: "REPLIED", groupStatus: "JOINED", joinedOn: "2026-07-03" },
      { id: id("customer-expert"), phone: `43${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, repliedOn: "2026-07-02", replyStatus: "REPLIED", groupStatus: "JOINED", joinedOn: "2026-07-03", expertIntroducedOn: "2026-07-04" },
    ] });
    const expertCustomer = await db.leadCustomer.findUniqueOrThrow({ where: { id: id("customer-expert") } });
    const order = await db.customerOrder.create({ data: {
      id: id("customer-order"), phone: expertCustomer.phone, batchId: expertCustomer.batchId,
      leadId: expertCustomer.id, enteredById: ids.lead, openedOn: "2026-07-06", initialDepositCents: 10_000,
    } });
    await db.metricEvent.createMany({ data: [
      { batchId: expertCustomer.batchId, enteredById: ids.lead, occurredOn: "2026-07-06", kind: "RECHARGE", amountCents: 10_000, customerOrderId: order.id, derivedFromLedger: true },
      { batchId: expertCustomer.batchId, enteredById: ids.lead, occurredOn: "2026-07-07", kind: "RECHARGE", amountCents: 2_500, continuationNumber: 1, customerOrderId: order.id, derivedFromLedger: true },
      { batchId: expertCustomer.batchId, enteredById: ids.lead, occurredOn: "2026-07-08", kind: "WITHDRAWAL", amountCents: 500, customerOrderId: order.id, derivedFromLedger: true },
    ] });
    await signIn(ids.lead);
    const reception = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=reception"))).json();
    const group = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=group"))).json();
    const expert = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=expert"))).json();
    expect(reception.counts).toMatchObject({ reception: 2, group: 2, expert: 1 });
    expect(reception.customers.map((customer: { id: string }) => customer.id)).toContain(id("customer-pending-reply"));
    expect(reception.customers.map((customer: { id: string }) => customer.id)).toContain(id("customer-reception"));
    expect(reception.customers.map((customer: { id: string }) => customer.id)).not.toContain(id("customer-archived"));
    expect(group.customers.map((customer: { id: string }) => customer.id)).toEqual(expect.arrayContaining([id("customer-group"), id("customer-expert")]));
    expect(expert.customers.map((customer: { id: string }) => customer.id)).toContain(id("customer-expert"));
    expect(expert.customers.find((customer: { id: string }) => customer.id === id("customer-expert")).order).toMatchObject({
      initialDepositCents: 10_000, rechargeCents: 2_500, withdrawalCents: 500, nextContinuationNumber: 2,
    });
  });

  it("非组长不能读取客户号码", async () => {
    await signIn(ids.companyManager);
    expect((await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=expert"))).status).toBe(403);
  });
});
