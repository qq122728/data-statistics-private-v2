import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET as getOrgReporting } from "../../src/app/api/org/reporting/route";
import { GET as getOrgChannelReporting } from "../../src/app/api/org/channel-reporting/route";
import { GET as getLeadChannelReporting } from "../../src/app/api/lead/channel-reporting/route";
import { GET as getLeadCustomerReporting } from "../../src/app/api/lead/customer-reporting/route";
import { PATCH as patchSharedCustomer } from "../../src/app/api/lead/customer-reporting/[leadId]/route";
import { GET as getResourceReporting } from "../../src/app/api/resource/reporting/route";

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
  berlinOperatorA: id("berlin-operator-a"), berlinOperatorB: id("berlin-operator-b"),
  berlinExpert: id("berlin-expert"),
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
    { id: ids.berlinOperatorA, username: ids.berlinOperatorA, name: "柏林炒群甲", role: "GROUP_OPERATOR", groupId: ids.berlinGroup },
    { id: ids.berlinOperatorB, username: ids.berlinOperatorB, name: "柏林炒群乙", role: "GROUP_OPERATOR", groupId: ids.berlinGroup },
    { id: ids.berlinExpert, username: ids.berlinExpert, name: "柏林专家", role: "EXPERT", groupId: ids.berlinGroup },
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
  await db.resourceChannelAccess.create({ data: { userId: ids.resource, channelId: id("berlin-channel") } });
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
  // 组织汇总的新权威来源：只有审核通过的每日填写会进入报表；上面的 MetricEvent
  // 继续留给渠道/客户进度接口，借此锁定“两本账互不串数”。
  for (const item of [
    { groupId: ids.berlinGroup, ownerId: ids.berlinReception, channelId: id("berlin-channel"), date: "2026-09-01", timezone: "Europe/Berlin", added: 3, effective: 2, replied: 1 },
    { groupId: ids.newYorkGroup, ownerId: ids.newYorkReception, channelId: id("new-york-channel"), date: "2026-08-31", timezone: "America/New_York", added: 4, effective: 4, replied: 0 },
    { groupId: ids.otherGroup, ownerId: ids.otherReception, channelId: id("other-channel"), date: "2026-09-01", timezone: "Asia/Singapore", added: 9, effective: 9, replied: 0 },
  ]) {
    const entry = await db.dailyStatEntry.create({ data: {
      identityKey: JSON.stringify([item.ownerId, item.groupId, item.date, "RECEPTION", item.channelId, null, null]),
      ownerId: item.ownerId, groupId: item.groupId, channelId: item.channelId,
      businessDate: item.date, timezone: item.timezone, position: "RECEPTION", status: "APPROVED",
    } });
    const revision = await db.dailyStatRevision.create({ data: {
      entryId: entry.id, version: 1, createdById: item.ownerId,
      dispatchCount: item.added, effectiveCount: item.effective, replyCount: item.replied,
    } });
    await db.dailyStatEntry.update({ where: { id: entry.id }, data: { currentRevisionId: revision.id, approvedRevisionId: revision.id } });
  }
  // 两条业务线最后填写日期故意错开：8/30 汇总必须延续甲在 8/29 的最后快照，
  // 不能因为乙在 8/30 又填了一次，就把甲整条线漏掉。
  for (const item of [
    { ownerId: ids.berlinOperatorA, sourceReceptionId: ids.berlinReception, date: "2026-08-28", inGroup: 7 },
    { ownerId: ids.berlinOperatorA, sourceReceptionId: ids.berlinReception, date: "2026-08-29", inGroup: 6 },
    { ownerId: ids.berlinOperatorB, sourceReceptionId: ids.berlinReception, date: "2026-08-30", inGroup: 11 },
  ]) {
    const channelId = id("berlin-channel");
    const entry = await db.dailyStatEntry.create({ data: {
      identityKey: JSON.stringify([item.ownerId, ids.berlinGroup, item.date, "GROUP_OPERATOR", channelId, item.sourceReceptionId, null]),
      ownerId: item.ownerId, groupId: ids.berlinGroup, channelId,
      sourceReceptionId: item.sourceReceptionId,
      businessDate: item.date, timezone: "Europe/Berlin", position: "GROUP_OPERATOR", status: "APPROVED",
    } });
    const revision = await db.dailyStatRevision.create({ data: {
      entryId: entry.id, version: 1, createdById: item.ownerId,
      currentInGroupCount: item.inGroup,
    } });
    await db.dailyStatEntry.update({ where: { id: entry.id }, data: { currentRevisionId: revision.id, approvedRevisionId: revision.id } });
  }
  // A 是永久客户归属人，B/C 只是代为执行炒群和专家环节。
  // 下游漏斗和资金必须全部回到 A 的个人行，不能被 B/C 抢走。
  const channelId = id("berlin-channel");
  const operatorEntry = await db.dailyStatEntry.create({ data: {
    identityKey: JSON.stringify([ids.berlinOperatorB, ids.berlinGroup, "2026-09-01", "GROUP_OPERATOR", channelId, ids.berlinReception, null]),
    ownerId: ids.berlinOperatorB, groupId: ids.berlinGroup, channelId,
    sourceReceptionId: ids.berlinReception, businessDate: "2026-09-01", timezone: "Europe/Berlin", position: "GROUP_OPERATOR", status: "APPROVED",
  } });
  const operatorRevision = await db.dailyStatRevision.create({ data: {
    entryId: operatorEntry.id, version: 1, createdById: ids.berlinOperatorB,
    normalLeaveCount: 1, abnormalLeaveCount: 1, currentInGroupCount: 11, expertIntroCount: 2,
  } });
  await db.dailyStatEntry.update({ where: { id: operatorEntry.id }, data: { currentRevisionId: operatorRevision.id, approvedRevisionId: operatorRevision.id } });

  const expertEntry = await db.dailyStatEntry.create({ data: {
    identityKey: JSON.stringify([ids.berlinExpert, ids.berlinGroup, "2026-09-01", "EXPERT", channelId, ids.berlinReception, ids.berlinOperatorB]),
    ownerId: ids.berlinExpert, groupId: ids.berlinGroup, channelId,
    sourceReceptionId: ids.berlinReception, sourceGroupOperatorId: ids.berlinOperatorB,
    businessDate: "2026-09-01", timezone: "Europe/Berlin", position: "EXPERT", status: "APPROVED",
  } });
  const expertRevision = await db.dailyStatRevision.create({ data: {
    entryId: expertEntry.id, version: 1, createdById: ids.berlinExpert,
    expertReceivedCount: 2, expertContactedCount: 2, registrationCount: 2, orderCount: 1,
    cryptoInitialDepositCents: 10_000, cryptoRechargeCents: 5_000, withdrawalCents: 2_000,
  } });
  await db.dailyStatEntry.update({ where: { id: expertEntry.id }, data: { currentRevisionId: expertRevision.id, approvedRevisionId: expertRevision.id } });
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
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      roleAssignments: { select: { role: true } },
      resourceChannelAccess: { select: { channelId: true } },
    },
  });
  vi.spyOn(auth, "requireUser").mockResolvedValue(user as auth.SessionUser);
}

const request = (query = "range=today") => new Request(`http://localhost/api/org/reporting?${query}`);

describe.sequential("新版组织范围真实报表 API", () => {
  it("按每条炒群业务线延续截止日最近快照，并归回来源接粉人", async () => {
    await signIn(ids.companyManager);
    const response = await getOrgReporting(request("range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31"));
    const body = await response.json();
    expect(body.groups.find((group: { id: string }) => group.id === ids.berlinGroup)).toMatchObject({ totals: { inGroup: 17 } });
    expect(body.members.find((member: { id: string }) => member.id === ids.berlinReception)).toMatchObject({ totals: { inGroup: 17 } });
    expect(body.members.find((member: { id: string }) => member.id === ids.berlinOperatorA)).toMatchObject({ totals: { inGroup: 0 } });
    expect(body.members.find((member: { id: string }) => member.id === ids.berlinOperatorB)).toMatchObject({ totals: { inGroup: 0 } });
  });

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
    expect(new Set(body.members.map((member: { id: string }) => member.id))).toEqual(new Set([
      ids.berlinReception, ids.berlinOperatorA, ids.berlinOperatorB, ids.berlinExpert, ids.newYorkReception,
    ]));
    expect(body.days.find((day: { date: string }) => day.date === "2026-09-01")).toMatchObject({
      groups: expect.arrayContaining([expect.objectContaining({ groupId: ids.berlinGroup, totals: expect.objectContaining({ added: 3, effective: 2 }) })]),
      members: expect.arrayContaining([expect.objectContaining({ id: ids.berlinReception, totals: expect.objectContaining({ added: 3, effective: 2 }) })]),
    });
  });

  it("A 接粉、B 炒群、C 专家时，全漏斗和净业绩只归 A，B/C 不抢归属", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.companyManager);
    const response = await getOrgReporting(request("range=today"));
    const body = await response.json();
    expect(body.members.find((member: { id: string }) => member.id === ids.berlinReception)).toMatchObject({
      totals: {
        added: 3, effective: 2, replied: 1, leftNormal: 1, leftAbnormal: 1,
        pushed: 2, registered: 2, ordered: 1,
        initialDepositCents: 10_000, rechargeCents: 5_000,
        depositCents: 15_000, withdrawalCents: 2_000, netCents: 13_000,
      },
    });
    expect(body.members.find((member: { id: string }) => member.id === ids.berlinOperatorB)).toMatchObject({ totals: { pushed: 0, registered: 0, ordered: 0, netCents: 0 } });
    expect(body.members.find((member: { id: string }) => member.id === ids.berlinExpert)).toMatchObject({ totals: { registered: 0, ordered: 0, netCents: 0 } });
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
  it("渠道区间内没有任何新记录时，仍按业务线延续此前最近快照", async () => {
    await signIn(ids.lead);
    const response = await getLeadChannelReporting(new Request("http://localhost/api/lead/channel-reporting?range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31"));
    const body = await response.json();
    expect(body.rows[0]).toMatchObject({ totals: { inGroup: 17 } });
    expect(body.members).toEqual([
      expect.objectContaining({ id: ids.berlinReception, totals: expect.objectContaining({ inGroup: 17 }) }),
    ]);
    expect(body.days).toEqual([]);
  });

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
    expect(body.rows[0].members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.berlinReception, name: expect.any(String), totals: expect.objectContaining({ added: 3, effective: 2, replied: 1 }) }),
    ]));
    expect(body.summary).toMatchObject({
      name: "全组",
      totals: { added: 3, effective: 2, replied: 1, inGroup: 17 },
      derivedRates: { effectiveRate: 2 / 3, replyRate: 1 / 2 },
    });
    expect(body.members.find((member: { id: string }) => member.id === ids.berlinReception)).toMatchObject({
      totals: { added: 3, effective: 2, replied: 1 },
      channels: [expect.objectContaining({ name: "柏林渠道", totals: expect.objectContaining({ added: 3, effective: 2 }) })],
    });
    expect(body.analysis).toEqual(expect.arrayContaining([
      expect.objectContaining({ tone: "info", title: "柏林渠道 贡献净业绩最多" }),
    ]));
    expect(body.days).toEqual([
      expect.objectContaining({
        date: "2026-09-01",
        summary: expect.objectContaining({ name: "2026-09-01", totals: expect.objectContaining({ added: 3, effective: 2, replied: 1 }) }),
        rows: [expect.objectContaining({ name: "柏林渠道", totals: expect.objectContaining({ added: 3, effective: 2, replied: 1 }) })],
      }),
    ]);
  });

  it("非组长不能借该接口读取渠道明细", async () => {
    await signIn(ids.departmentManager);
    expect((await getLeadChannelReporting(new Request("http://localhost/api/lead/channel-reporting?range=month"))).status).toBe(403);
  });
});

describe.sequential("组织管理员小组渠道报表 API", () => {
  it("组织渠道汇总延续每条业务线在截止日前的最近快照", async () => {
    await signIn(ids.departmentManager);
    const response = await getOrgChannelReporting(new Request(`http://localhost/api/org/channel-reporting?range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31&groupId=${ids.berlinGroup}`));
    expect(await response.json()).toMatchObject({ rows: [expect.objectContaining({ totals: expect.objectContaining({ inGroup: 17 }) })] });
  });

  it("部门管理员只能读取本部门小组，公司管理员可以读取本公司跨部门小组", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.departmentManager);
    const own = await getOrgChannelReporting(new Request(`http://localhost/api/org/channel-reporting?range=today&groupId=${ids.berlinGroup}`));
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      group: { id: ids.berlinGroup },
      rows: [expect.objectContaining({ name: "柏林渠道", totals: expect.objectContaining({ added: 3 }) })],
      days: [expect.objectContaining({ date: "2026-09-01", rows: [expect.objectContaining({ name: "柏林渠道", totals: expect.objectContaining({ added: 3 }) })] })],
    });
    expect((await getOrgChannelReporting(new Request(`http://localhost/api/org/channel-reporting?range=today&groupId=${ids.newYorkGroup}`))).status).toBe(403);

    await signIn(ids.companyManager);
    expect((await getOrgChannelReporting(new Request(`http://localhost/api/org/channel-reporting?range=today&groupId=${ids.newYorkGroup}`))).status).toBe(200);
  });

  it("资源部不能借组织管理员接口读取渠道明细", async () => {
    await signIn(ids.resource);
    expect((await getOrgChannelReporting(new Request(`http://localhost/api/org/channel-reporting?range=month&groupId=${ids.berlinGroup}`))).status).toBe(403);
  });
});

describe.sequential("资源部真实报表快照", () => {
  it("资源汇总延续每条业务线在截止日前的最近快照", async () => {
    await signIn(ids.resource);
    const response = await getResourceReporting(new Request("http://localhost/api/resource/reporting?range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31"));
    expect(await response.json()).toMatchObject({ rows: [expect.objectContaining({ totals: expect.objectContaining({ inGroup: 17 }) })] });
  });

  it("资源部按人员查看时，下游进度和资金仍归最初接粉组员", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.resource);
    const response = await getResourceReporting(new Request("http://localhost/api/resource/reporting?range=today"));
    const body = await response.json();
    const attributed = body.memberRows.find((row: { member: { id: string }; channelId: string }) =>
      row.member.id === ids.berlinReception && row.channelId === id("berlin-channel"));
    expect(attributed).toMatchObject({
      member: { id: ids.berlinReception },
      totals: {
        added: 3,
        effective: 2,
        pushed: 2,
        registered: 2,
        ordered: 1,
        initialDepositCents: 10_000,
        rechargeCents: 5_000,
        withdrawalCents: 2_000,
      },
    });
    expect(body.memberRows.some((row: { member: { id: string }; totals: { registered: number; ordered: number } }) =>
      [ids.berlinOperatorB, ids.berlinExpert].includes(row.member.id)
      && (row.totals.registered > 0 || row.totals.ordered > 0))).toBe(false);
  });
});

describe.sequential("新版客户进度 API", () => {
  it("按接粉、炒群、专家阶段读取本组真实客户并返回分页数量", async () => {
    const device = await db.device.create({ data: {
      id: id("customer-device"), code: "B-22", groupId: ids.berlinGroup, memberId: ids.berlinReception,
    } });
    await db.leadCustomer.createMany({ data: [
      { id: id("customer-pending-reply"), phone: `40${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception },
      { id: id("customer-reception"), phone: `41${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, repliedOn: "2026-07-02", replyStatus: "REPLIED" },
      { id: id("customer-archived"), phone: `44${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, repliedOn: "2026-07-02", replyStatus: "REPLIED", receptionArchivedAt: new Date("2026-07-05T12:00:00Z"), receptionArchiveReason: "历史归档", receptionArchiveVisitCount: 2 },
      { id: id("customer-group"), phone: `42${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, deviceId: device.id, repliedOn: "2026-07-02", replyStatus: "REPLIED", groupStatus: "JOINED", joinedOn: "2026-07-03" },
      { id: id("customer-expert"), phone: `43${suffix.replaceAll("-", "").slice(0, 10)}`, batchId: (await db.sourceBatch.findFirstOrThrow({ where: { groupId: ids.berlinGroup } })).id, ownerId: ids.berlinReception, repliedOn: "2026-07-02", replyStatus: "REPLIED", groupStatus: "JOINED", joinedOn: "2026-07-03", expertIntroducedOn: "2026-07-04" },
    ] });
    const expertCustomer = await db.leadCustomer.findUniqueOrThrow({ where: { id: id("customer-expert") } });
    const order = await db.customerOrder.create({ data: {
      id: id("customer-order"), phone: expertCustomer.phone, batchId: expertCustomer.batchId,
      leadId: expertCustomer.id, enteredById: ids.lead, openedOn: "2026-07-06", initialDepositCents: 10_000,
    } });
    await db.customerFinanceEvent.createMany({ data: [
      { batchId: expertCustomer.batchId, enteredById: ids.lead, occurredOn: "2026-07-06", kind: "RECHARGE", amountCents: 10_000, customerOrderId: order.id },
      { batchId: expertCustomer.batchId, enteredById: ids.lead, occurredOn: "2026-07-07", kind: "RECHARGE", amountCents: 2_500, continuationNumber: 1, customerOrderId: order.id },
      { batchId: expertCustomer.batchId, enteredById: ids.lead, occurredOn: "2026-07-08", kind: "WITHDRAWAL", amountCents: 500, customerOrderId: order.id },
    ] });
    await signIn(ids.lead);
    const reception = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=reception"))).json();
    const group = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=group"))).json();
    const expert = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=expert"))).json();
    const orderedExperts = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=expert&expertStage=ORDERED"))).json();
    expect(reception.counts).toMatchObject({ reception: 2, group: 2, expert: 1 });
    expect(reception.customers.map((customer: { id: string }) => customer.id)).toContain(id("customer-pending-reply"));
    expect(reception.customers.map((customer: { id: string }) => customer.id)).toContain(id("customer-reception"));
    expect(reception.customers.map((customer: { id: string }) => customer.id)).not.toContain(id("customer-archived"));
    expect(group.customers.map((customer: { id: string }) => customer.id)).toEqual(expect.arrayContaining([id("customer-group"), id("customer-expert")]));
    expect(group.customers.find((customer: { id: string }) => customer.id === id("customer-group")).device).toEqual({ id: device.id, code: "B-22" });
    expect(group.channels).toContain("柏林渠道");
    expect(group.summary).toMatchObject({ customerCount: 2, orderCount: 1, initialDepositCents: 10_000, rechargeCents: 2_500, withdrawalCents: 500 });
    const unmatchedChannel = await (await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=group&channel=不存在的渠道"))).json();
    expect(unmatchedChannel).toMatchObject({ total: 0, summary: { customerCount: 0, orderCount: 0, initialDepositCents: 0, rechargeCents: 0, withdrawalCents: 0 } });
    expect(expert.customers.map((customer: { id: string }) => customer.id)).toContain(id("customer-expert"));
    expect(expert.expertCounts).toMatchObject({ ORDERED: 1, QUEUED: 0, TRACKING: 0, PENDING_ORDER: 0 });
    expect(orderedExperts.expertStage).toBe("ORDERED");
    expect(orderedExperts.customers.map((customer: { id: string }) => customer.id)).toEqual([id("customer-expert")]);
    expect(expert.customers.find((customer: { id: string }) => customer.id === id("customer-expert")).order).toMatchObject({
      initialDepositCents: 10_000, rechargeCents: 2_500, withdrawalCents: 500, nextContinuationNumber: 2,
    });
  });

  it("接粉只能读取本人客户；公司管理员必须明确选择权限内小组", async () => {
    await signIn(ids.berlinReception);
    const self = await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=group"));
    expect(self.status).toBe(200);
    expect((await self.json()).customers.every((customer: { owner: { id: string } }) => customer.owner.id === ids.berlinReception)).toBe(true);
    expect((await getLeadCustomerReporting(new Request(`http://localhost/api/lead/customer-reporting?stage=group&groupId=${ids.newYorkGroup}`))).status).toBe(403);

    await signIn(ids.companyManager);
    expect((await getLeadCustomerReporting(new Request("http://localhost/api/lead/customer-reporting?stage=expert"))).status).toBe(400);
    expect((await getLeadCustomerReporting(new Request(`http://localhost/api/lead/customer-reporting?stage=expert&groupId=${ids.berlinGroup}`))).status).toBe(200);
  });

  it("共享表按接粉、炒群、专家负责人逐列交接并记录审计", async () => {
    const leadId = id("customer-group");
    const patch = (body: Record<string, unknown>) => patchSharedCustomer(
      new Request(`http://localhost/api/lead/customer-reporting/${leadId}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ leadId }) },
    );

    await signIn(ids.berlinExpert);
    expect((await patch({ action: "assignGroupOperator", userId: ids.berlinOperatorA })).status).toBe(403);

    await signIn(ids.berlinReception);
    expect((await patch({ action: "assignGroupOperator", userId: ids.berlinOperatorA })).status).toBe(200);
    expect((await patch({ action: "setDeviceCode", code: "B-手填-08" })).status).toBe(200);

    await signIn(ids.berlinOperatorA);
    expect((await patch({ action: "assignExpert", userId: ids.berlinExpert })).status).toBe(200);

    await signIn(ids.berlinExpert);
    expect((await patch({ action: "setRegistration", occurredOn: "2026-07-09" })).status).toBe(200);

    expect(await db.leadCustomer.findUniqueOrThrow({ where: { id: leadId }, select: { groupOperatorOwnerId: true, expertOwnerId: true, registeredOn: true, device: { select: { code: true } } } })).toEqual({
      groupOperatorOwnerId: ids.berlinOperatorA,
      expertOwnerId: ids.berlinExpert,
      registeredOn: "2026-07-09",
      device: { code: "B-手填-08" },
    });
    expect(await db.auditLog.count({ where: { entityId: leadId, action: { startsWith: "SHARED_CUSTOMER_" } } })).toBe(4);
  });
});
