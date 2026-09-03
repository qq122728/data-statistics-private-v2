import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import * as leadMembers from "../../src/lib/lead-members";
import { db } from "../../src/lib/db";
import { GET as getOrgReporting } from "../../src/app/api/org/reporting/route";
import { GET as getOrgChannelReporting } from "../../src/app/api/org/channel-reporting/route";
import { GET as getLeadChannelReporting } from "../../src/app/api/lead/channel-reporting/route";
import {
  GET as getLeadCustomerReporting,
  POST as postLeadCustomerReporting,
} from "../../src/app/api/lead/customer-reporting/route";
import { PATCH as patchSharedCustomer } from "../../src/app/api/lead/customer-reporting/[leadId]/route";
import { POST as correctSharedCustomerAttribution } from "../../src/app/api/lead/customer-reporting/[leadId]/attribution-correction/route";
import { POST as postCustomerOrder } from "../../src/app/api/customer-orders/route";
import { GET as getPerformanceLeaderboard } from "../../src/app/api/performance-leaderboard/route";
import { GET as getLeadMemberDailyStats } from "../../src/app/api/lead/member-daily-stats/[memberId]/route";
import { GET as getResourceReporting } from "../../src/app/api/resource/reporting/route";
import { syncCustomerGroupEvent } from "../../src/lib/customer-number-event-sync";

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
  execFileSync(
    process.execPath,
    [
      join(process.cwd(), "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
    },
  );
  isolatedDatabase.directory = directory;
  const db = new PrismaClient({ datasourceUrl: `file:${databasePath}` });
  return {
    db,
    getOrCreateSourceBatch: async (
      key: { groupId: string; channelId: string; sourceDate: string },
      client = db,
    ) => {
      const channel = await client.channel.findUniqueOrThrow({
        where: { id_groupId: { id: key.channelId, groupId: key.groupId } },
        select: { channelType: true },
      });
      return client.sourceBatch.upsert({
        where: { groupId_channelId_sourceDate: key },
        update: {},
        create: { ...key, channelTypeSnapshot: channel.channelType },
      });
    },
  };
});

const suffix = randomUUID();
const id = (value: string) => `org-reporting-${value}-${suffix}`;
const ids = {
  companyA: id("company-a"),
  companyB: id("company-b"),
  berlinDept: id("berlin-dept"),
  newYorkDept: id("new-york-dept"),
  otherDept: id("other-dept"),
  berlinGroup: id("berlin-group"),
  newYorkGroup: id("new-york-group"),
  otherGroup: id("other-group"),
  berlinReception: id("berlin-reception"),
  newYorkReception: id("new-york-reception"),
  otherReception: id("other-reception"),
  berlinOperatorA: id("berlin-operator-a"),
  berlinOperatorB: id("berlin-operator-b"),
  berlinExpert: id("berlin-expert"),
  lead: id("lead"),
  departmentManager: id("department-manager"),
  companyManager: id("company-manager"),
  hqManager: id("hq-manager"),
  resource: id("resource"),
};

beforeAll(async () => {
  await db.company.createMany({
    data: [
      { id: ids.companyA, name: `报表公司A-${suffix}` },
      { id: ids.companyB, name: `报表公司B-${suffix}` },
    ],
  });
  await db.department.createMany({
    data: [
      {
        id: ids.berlinDept,
        name: `柏林部门-${suffix}`,
        companyId: ids.companyA,
        countryCode: "DE",
        timezone: "Europe/Berlin",
      },
      {
        id: ids.newYorkDept,
        name: `纽约部门-${suffix}`,
        companyId: ids.companyA,
        countryCode: "US",
        timezone: "America/New_York",
      },
      {
        id: ids.otherDept,
        name: `其它公司部门-${suffix}`,
        companyId: ids.companyB,
        countryCode: "SG",
        timezone: "Asia/Singapore",
      },
    ],
  });
  await db.teamGroup.createMany({
    data: [
      {
        id: ids.berlinGroup,
        name: `柏林一组-${suffix}`,
        departmentId: ids.berlinDept,
      },
      {
        id: ids.newYorkGroup,
        name: `纽约一组-${suffix}`,
        departmentId: ids.newYorkDept,
      },
      {
        id: ids.otherGroup,
        name: `其它一组-${suffix}`,
        departmentId: ids.otherDept,
      },
    ],
  });
  await db.user.createMany({
    data: [
      {
        id: ids.berlinReception,
        username: ids.berlinReception,
        name: "柏林接粉",
        role: "RECEPTION",
        groupId: ids.berlinGroup,
      },
      {
        id: ids.newYorkReception,
        username: ids.newYorkReception,
        name: "纽约接粉",
        role: "RECEPTION",
        groupId: ids.newYorkGroup,
      },
      {
        id: ids.otherReception,
        username: ids.otherReception,
        name: "其它接粉",
        role: "RECEPTION",
        groupId: ids.otherGroup,
      },
      {
        id: ids.berlinOperatorA,
        username: ids.berlinOperatorA,
        name: "柏林炒群甲",
        role: "GROUP_OPERATOR",
        groupId: ids.berlinGroup,
      },
      {
        id: ids.berlinOperatorB,
        username: ids.berlinOperatorB,
        name: "柏林炒群乙",
        role: "GROUP_OPERATOR",
        groupId: ids.berlinGroup,
      },
      {
        id: ids.berlinExpert,
        username: ids.berlinExpert,
        name: "柏林专家",
        role: "EXPERT",
        groupId: ids.berlinGroup,
      },
      {
        id: ids.lead,
        username: ids.lead,
        name: "柏林组长",
        role: "LEAD",
        duty: "LEAD",
        groupId: ids.berlinGroup,
      },
      {
        id: ids.departmentManager,
        username: ids.departmentManager,
        name: "柏林部门管理员",
        role: "COMPANY_MANAGER",
        duty: "DEPARTMENT_MANAGER",
        departmentId: ids.berlinDept,
      },
      {
        id: ids.companyManager,
        username: ids.companyManager,
        name: "A公司管理员",
        role: "COMPANY_MANAGER",
        duty: "COMPANY_MANAGER",
        companyId: ids.companyA,
      },
      {
        id: ids.hqManager,
        username: ids.hqManager,
        name: "总公司管理员",
        role: "COMPANY_MANAGER",
        duty: "HQ_MANAGER",
      },
      {
        id: ids.resource,
        username: ids.resource,
        name: "资源部",
        role: "RESOURCE_MANAGER",
        duty: "RESOURCE_MANAGER",
      },
    ],
  });
  await db.channel.createMany({
    data: [
      {
        id: id("berlin-channel"),
        groupId: ids.berlinGroup,
        name: "柏林渠道",
        normalizedName: "柏林渠道",
      },
      {
        id: id("new-york-channel"),
        groupId: ids.newYorkGroup,
        name: "纽约渠道",
        normalizedName: "纽约渠道",
      },
      {
        id: id("other-channel"),
        groupId: ids.otherGroup,
        name: "其它渠道",
        normalizedName: "其它渠道",
      },
    ],
  });
  await db.resourceChannelAccess.create({
    data: { userId: ids.resource, channelId: id("berlin-channel") },
  });
  const [berlinBatch, newYorkBatch, otherBatch] = await Promise.all([
    db.sourceBatch.create({
      data: {
        groupId: ids.berlinGroup,
        channelId: id("berlin-channel"),
        sourceDate: "2026-09-01",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.newYorkGroup,
        channelId: id("new-york-channel"),
        sourceDate: "2026-08-31",
      },
    }),
    db.sourceBatch.create({
      data: {
        groupId: ids.otherGroup,
        channelId: id("other-channel"),
        sourceDate: "2026-09-01",
      },
    }),
  ]);
  await db.metricEvent.createMany({
    data: [
      {
        batchId: berlinBatch.id,
        enteredById: ids.berlinReception,
        occurredOn: "2026-09-01",
        kind: "NEW_FANS",
        quantity: 3,
      },
      {
        batchId: berlinBatch.id,
        enteredById: ids.berlinReception,
        occurredOn: "2026-09-01",
        kind: "EFFECTIVE_FANS",
        quantity: 2,
      },
      {
        batchId: berlinBatch.id,
        enteredById: ids.berlinReception,
        occurredOn: "2026-09-01",
        kind: "REPLIES",
        quantity: 1,
      },
      {
        batchId: newYorkBatch.id,
        enteredById: ids.newYorkReception,
        occurredOn: "2026-08-31",
        kind: "NEW_FANS",
        quantity: 4,
      },
      {
        batchId: otherBatch.id,
        enteredById: ids.otherReception,
        occurredOn: "2026-09-01",
        kind: "NEW_FANS",
        quantity: 9,
      },
    ],
  });
  // 组织汇总的新权威来源：只有审核通过的每日填写会进入报表；上面的 MetricEvent
  // 继续留给渠道/客户进度接口，借此锁定“两本账互不串数”。
  for (const item of [
    {
      groupId: ids.berlinGroup,
      ownerId: ids.berlinReception,
      channelId: id("berlin-channel"),
      date: "2026-09-01",
      timezone: "Europe/Berlin",
      added: 3,
      effective: 2,
      replied: 1,
    },
    {
      groupId: ids.newYorkGroup,
      ownerId: ids.newYorkReception,
      channelId: id("new-york-channel"),
      date: "2026-08-31",
      timezone: "America/New_York",
      added: 4,
      effective: 4,
      replied: 0,
    },
    {
      groupId: ids.otherGroup,
      ownerId: ids.otherReception,
      channelId: id("other-channel"),
      date: "2026-09-01",
      timezone: "Asia/Singapore",
      added: 9,
      effective: 9,
      replied: 0,
    },
  ]) {
    const entry = await db.dailyStatEntry.create({
      data: {
        identityKey: JSON.stringify([
          item.ownerId,
          item.groupId,
          item.date,
          "RECEPTION",
          item.channelId,
          null,
          null,
        ]),
        ownerId: item.ownerId,
        groupId: item.groupId,
        channelId: item.channelId,
        businessDate: item.date,
        timezone: item.timezone,
        position: "RECEPTION",
        status: "APPROVED",
      },
    });
    const revision = await db.dailyStatRevision.create({
      data: {
        entryId: entry.id,
        version: 1,
        createdById: item.ownerId,
        dispatchCount: item.added,
        effectiveCount: item.effective,
        replyCount: item.replied,
      },
    });
    await db.dailyStatEntry.update({
      where: { id: entry.id },
      data: { currentRevisionId: revision.id, approvedRevisionId: revision.id },
    });
  }
  // 两条业务线最后填写日期故意错开：8/30 汇总必须延续甲在 8/29 的最后快照，
  // 不能因为乙在 8/30 又填了一次，就把甲整条线漏掉。
  for (const item of [
    {
      ownerId: ids.berlinOperatorA,
      sourceReceptionId: ids.berlinReception,
      date: "2026-08-28",
      inGroup: 7,
    },
    {
      ownerId: ids.berlinOperatorA,
      sourceReceptionId: ids.berlinReception,
      date: "2026-08-29",
      inGroup: 6,
    },
    {
      ownerId: ids.berlinOperatorB,
      sourceReceptionId: ids.berlinReception,
      date: "2026-08-30",
      inGroup: 11,
    },
  ]) {
    const channelId = id("berlin-channel");
    const entry = await db.dailyStatEntry.create({
      data: {
        identityKey: JSON.stringify([
          item.ownerId,
          ids.berlinGroup,
          item.date,
          "GROUP_OPERATOR",
          channelId,
          item.sourceReceptionId,
          null,
        ]),
        ownerId: item.ownerId,
        groupId: ids.berlinGroup,
        channelId,
        sourceReceptionId: item.sourceReceptionId,
        businessDate: item.date,
        timezone: "Europe/Berlin",
        position: "GROUP_OPERATOR",
        status: "APPROVED",
      },
    });
    const revision = await db.dailyStatRevision.create({
      data: {
        entryId: entry.id,
        version: 1,
        createdById: item.ownerId,
        currentInGroupCount: item.inGroup,
      },
    });
    await db.dailyStatEntry.update({
      where: { id: entry.id },
      data: { currentRevisionId: revision.id, approvedRevisionId: revision.id },
    });
  }
  // A 是永久客户归属人，B/C 只是代为执行炒群和专家环节。
  // 下游漏斗和资金必须全部回到 A 的个人行，不能被 B/C 抢走。
  const channelId = id("berlin-channel");
  const operatorEntry = await db.dailyStatEntry.create({
    data: {
      identityKey: JSON.stringify([
        ids.berlinOperatorB,
        ids.berlinGroup,
        "2026-09-01",
        "GROUP_OPERATOR",
        channelId,
        ids.berlinReception,
        null,
      ]),
      ownerId: ids.berlinOperatorB,
      groupId: ids.berlinGroup,
      channelId,
      sourceReceptionId: ids.berlinReception,
      businessDate: "2026-09-01",
      timezone: "Europe/Berlin",
      position: "GROUP_OPERATOR",
      status: "APPROVED",
    },
  });
  const operatorRevision = await db.dailyStatRevision.create({
    data: {
      entryId: operatorEntry.id,
      version: 1,
      createdById: ids.berlinOperatorB,
      normalLeaveCount: 1,
      abnormalLeaveCount: 1,
      currentInGroupCount: 11,
      expertIntroCount: 2,
    },
  });
  await db.dailyStatEntry.update({
    where: { id: operatorEntry.id },
    data: {
      currentRevisionId: operatorRevision.id,
      approvedRevisionId: operatorRevision.id,
    },
  });

  const expertEntry = await db.dailyStatEntry.create({
    data: {
      identityKey: JSON.stringify([
        ids.berlinExpert,
        ids.berlinGroup,
        "2026-09-01",
        "EXPERT",
        channelId,
        ids.berlinReception,
        ids.berlinOperatorB,
      ]),
      ownerId: ids.berlinExpert,
      groupId: ids.berlinGroup,
      channelId,
      sourceReceptionId: ids.berlinReception,
      sourceGroupOperatorId: ids.berlinOperatorB,
      businessDate: "2026-09-01",
      timezone: "Europe/Berlin",
      position: "EXPERT",
      status: "APPROVED",
    },
  });
  const expertRevision = await db.dailyStatRevision.create({
    data: {
      entryId: expertEntry.id,
      version: 1,
      createdById: ids.berlinExpert,
      expertReceivedCount: 2,
      expertContactedCount: 2,
      registrationCount: 2,
      orderCount: 1,
      cryptoInitialDepositCents: 10_000,
      cryptoRechargeCents: 5_000,
      withdrawalCents: 2_000,
    },
  });
  await db.dailyStatEntry.update({
    where: { id: expertEntry.id },
    data: {
      currentRevisionId: expertRevision.id,
      approvedRevisionId: expertRevision.id,
    },
  });
});

afterAll(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.$disconnect();
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

const request = (query = "range=today") =>
  new Request(`http://localhost/api/org/reporting?${query}`);

describe.sequential("新版组织范围真实报表 API", () => {
  it("按每条炒群业务线延续截止日最近快照，并归回来源接粉人", async () => {
    await signIn(ids.companyManager);
    const response = await getOrgReporting(
      request("range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31"),
    );
    const body = await response.json();
    expect(
      body.groups.find((group: { id: string }) => group.id === ids.berlinGroup),
    ).toMatchObject({ totals: { inGroup: 17 } });
    expect(
      body.members.find(
        (member: { id: string }) => member.id === ids.berlinReception,
      ),
    ).toMatchObject({ totals: { inGroup: 17 } });
    expect(
      body.members.find(
        (member: { id: string }) => member.id === ids.berlinOperatorA,
      ),
    ).toMatchObject({ totals: { inGroup: 0 } });
    expect(
      body.members.find(
        (member: { id: string }) => member.id === ids.berlinOperatorB,
      ),
    ).toMatchObject({ totals: { inGroup: 0 } });
  });

  it("公司管理员只看到本公司，并按统一北京时间统计日取同一口径的汇总与人员", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.companyManager);
    const response = await getOrgReporting(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.groups.map((group: { id: string }) => group.id)).toEqual([
      ids.berlinGroup,
      ids.newYorkGroup,
    ]);
    expect(
      body.groups.find((group: { id: string }) => group.id === ids.berlinGroup),
    ).toMatchObject({
      period: { today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" },
      totals: { added: 3, effective: 2, replied: 1 },
    });
    expect(body.groupChannels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: ids.berlinGroup,
          groupName: expect.stringContaining("柏林一组"),
          company: { id: ids.companyA, name: expect.any(String) },
          department: { id: ids.berlinDept, name: expect.any(String) },
          channel: { name: "柏林渠道" },
          totals: expect.objectContaining({
            added: 3,
            effective: 2,
            replied: 1,
          }),
        }),
      ]),
    );
    expect(
      body.groups.find(
        (group: { id: string }) => group.id === ids.newYorkGroup,
      ),
    ).toMatchObject({
      period: { today: "2026-09-01", from: "2026-09-01", to: "2026-09-01" },
      totals: { added: 0 },
    });
    expect(
      new Set(body.members.map((member: { id: string }) => member.id)),
    ).toEqual(
      new Set([
        ids.berlinReception,
        ids.berlinOperatorA,
        ids.berlinOperatorB,
        ids.berlinExpert,
        ids.newYorkReception,
      ]),
    );
    expect(
      body.days.find((day: { date: string }) => day.date === "2026-09-01"),
    ).toMatchObject({
      groups: expect.arrayContaining([
        expect.objectContaining({
          groupId: ids.berlinGroup,
          totals: expect.objectContaining({ added: 3, effective: 2 }),
        }),
      ]),
      members: expect.arrayContaining([
        expect.objectContaining({
          id: ids.berlinReception,
          totals: expect.objectContaining({ added: 3, effective: 2 }),
        }),
      ]),
    });
  });

  it("A 接粉、B 炒群、C 专家时，全漏斗和净业绩只归 A，B/C 不抢归属", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.companyManager);
    const response = await getOrgReporting(request("range=today"));
    const body = await response.json();
    expect(
      body.members.find(
        (member: { id: string }) => member.id === ids.berlinReception,
      ),
    ).toMatchObject({
      totals: {
        added: 3,
        effective: 2,
        replied: 1,
        leftNormal: 1,
        leftAbnormal: 1,
        pushed: 2,
        registered: 2,
        ordered: 1,
        initialDepositCents: 10_000,
        rechargeCents: 5_000,
        depositCents: 15_000,
        withdrawalCents: 2_000,
        netCents: 13_000,
      },
    });
    expect(
      body.members.find(
        (member: { id: string }) => member.id === ids.berlinOperatorB,
      ),
    ).toMatchObject({
      totals: { pushed: 0, registered: 0, ordered: 0, netCents: 0 },
    });
    expect(
      body.members.find(
        (member: { id: string }) => member.id === ids.berlinExpert,
      ),
    ).toMatchObject({ totals: { registered: 0, ordered: 0, netCents: 0 } });
  });

  it("部门管理员和组长只能读取自己的范围，伪造其它小组会返回403", async () => {
    await signIn(ids.departmentManager);
    const department = await getOrgReporting(request());
    expect(
      (await department.json()).groups.map((group: { id: string }) => group.id),
    ).toEqual([ids.berlinGroup]);
    expect(
      (
        await getOrgReporting(
          request(`range=today&groupId=${ids.newYorkGroup}`),
        )
      ).status,
    ).toBe(403);

    await signIn(ids.lead);
    const lead = await getOrgReporting(request());
    expect(
      (await lead.json()).groups.map((group: { id: string }) => group.id),
    ).toEqual([ids.berlinGroup]);
  });

  it("总公司管理员能看到全部公司，资源部账号不能借这个接口查看组织业绩", async () => {
    await signIn(ids.hqManager);
    const hq = await getOrgReporting(request());
    expect(
      new Set(
        (await hq.json()).groups.map((group: { id: string }) => group.id),
      ),
    ).toEqual(new Set([ids.berlinGroup, ids.newYorkGroup, ids.otherGroup]));

    await signIn(ids.resource);
    expect((await getOrgReporting(request())).status).toBe(403);
  });
});

describe.sequential("新版组长真实渠道报表 API", () => {
  it("客户改渠道时漏斗数据一起搬家，但炒群和专家只负责进度，业绩仍归接粉人", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T03:30:00Z"));
    const originalChannelId = id("berlin-channel");
    const correctedChannelId = id("berlin-corrected-channel");
    await db.channel.create({
      data: {
        id: correctedChannelId,
        groupId: ids.berlinGroup,
        name: `柏林纠正渠道-${suffix}`,
        normalizedName: `柏林纠正渠道-${suffix}`,
      },
    });
    await signIn(ids.berlinReception);
    const created = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: `${Math.floor(100000 + Math.random() * 899999)}`,
          channelId: originalChannelId,
          sourceDate: "2026-09-02",
          joinedOn: "2026-09-02",
          groupOperatorOwnerId: ids.berlinOperatorA,
          deviceCode: "B-新增-01",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const customer = (await created.json()) as { id: string; phone: string };
    const afterJoin = await db.leadCustomer.findUniqueOrThrow({
      where: { id: customer.id },
      select: { groupQueueNumber: true, expertQueueNumber: true },
    });
    expect(afterJoin.groupQueueNumber ?? 0).toBeGreaterThan(0);
    expect(afterJoin.expertQueueNumber).toBeNull();
    const patch = (body: Record<string, unknown>) =>
      patchSharedCustomer(
        new Request(
          `http://localhost/api/lead/customer-reporting/${customer.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        ),
        { params: Promise.resolve({ leadId: customer.id }) },
      );
    const correctAttribution = (channelId: string, reason: string) =>
      correctSharedCustomerAttribution(
        new Request(
          `http://localhost/api/lead/customer-reporting/${customer.id}/attribution-correction`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attributionOwnerId: ids.berlinReception,
              channelId,
              sourceDate: "2026-09-02",
              reason,
            }),
          },
        ),
        { params: Promise.resolve({ leadId: customer.id }) },
      );

    expect(
      (
        await patch({
          action: "assignGroupOperator",
          userId: ids.berlinOperatorB,
        })
      ).status,
    ).toBe(200);
    expect(
      await db.leadCustomer.findUniqueOrThrow({
        where: { id: customer.id },
        select: { groupOperatorOwnerId: true },
      }),
    ).toEqual({ groupOperatorOwnerId: ids.berlinOperatorB });
    expect(
      (
        await patch({
          action: "assignGroupOperator",
          userId: ids.berlinOperatorA,
        })
      ).status,
    ).toBe(200);
    await signIn(ids.berlinExpert);
    expect(
      (
        await patch({
          action: "assignGroupOperator",
          userId: ids.berlinOperatorB,
        })
      ).status,
    ).toBe(403);
    await signIn(ids.berlinReception);
    expect(
      (await patch({ action: "setChannel", channelId: correctedChannelId }))
        .status,
    ).toBe(403);
    const forgedReceptionCorrection = await correctSharedCustomerAttribution(
      new Request(
        `http://localhost/api/lead/customer-reporting/${customer.id}/attribution-correction`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            attributionOwnerId: ids.berlinReception,
            channelId: correctedChannelId,
            sourceDate: "2026-09-01",
            reason: "尝试同时修改日期",
          }),
        },
      ),
      { params: Promise.resolve({ leadId: customer.id }) },
    );
    expect(forgedReceptionCorrection.status).toBe(403);
    expect((await correctAttribution(correctedChannelId, "创建时选错来源渠道")).status).toBe(200);
    await signIn(ids.berlinOperatorA);
    expect(
      (
        await patch({
          action: "assignExpert",
          userId: ids.berlinExpert,
          occurredOn: "2026-09-02",
        })
      )
        .status,
    ).toBe(200);
    const firstExpert = await db.leadCustomer.findUniqueOrThrow({
      where: { id: customer.id },
      select: {
        groupQueueNumber: true,
        expertIntroducedOn: true,
        expertQueueNumber: true,
      },
    });
    expect(firstExpert).toMatchObject({ expertIntroducedOn: "2026-09-02" });
    expect(firstExpert.groupQueueNumber).toBe(afterJoin.groupQueueNumber);
    expect(firstExpert.expertQueueNumber ?? 0).toBeGreaterThan(0);
    const afterExpert = firstExpert;
    expect(afterExpert.groupQueueNumber).toBe(afterJoin.groupQueueNumber);
    expect(afterExpert.expertQueueNumber ?? 0).toBeGreaterThan(0);
    const expertNumberSearch = await (
      await getLeadCustomerReporting(
        new Request(
          `http://localhost/api/lead/customer-reporting?stage=expert&q=E-${String(afterExpert.expertQueueNumber).padStart(3, "0")}`,
        ),
      )
    ).json();
    expect(
      expertNumberSearch.customers.map((item: { id: string }) => item.id),
    ).toContain(customer.id);
    await signIn(ids.berlinExpert);
    expect(
      (await patch({ action: "setRegistration", occurredOn: "2026-09-02" }))
        .status,
    ).toBe(200);
    const currentCustomer = await db.leadCustomer.findUniqueOrThrow({
      where: { id: customer.id },
      select: { batchId: true },
    });
    expect(
      (
        await postCustomerOrder(
          new Request("http://localhost/api/customer-orders", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              batchId: currentCustomer.batchId,
              leadId: customer.id,
              phone: customer.phone,
              openedOn: "2026-09-02",
              initialDepositCents: 10_000,
              initialDepositMethod: "BANK",
            }),
          }),
        )
      ).status,
    ).toBe(201);
    const numbered = await db.leadCustomer.findUniqueOrThrow({
      where: { id: customer.id },
      select: {
        joinedOn: true,
        groupQueueNumber: true,
        expertIntroducedOn: true,
        expertQueueNumber: true,
        registeredOn: true,
        registrationQueueNumber: true,
        customerOrder: { select: { openedOn: true, orderQueueNumber: true } },
      },
    });
    expect(numbered).toMatchObject({
      joinedOn: "2026-09-02",
      expertIntroducedOn: "2026-09-02",
      registeredOn: "2026-09-02",
      customerOrder: { openedOn: "2026-09-02" },
    });
    for (const value of [
      numbered.groupQueueNumber,
      numbered.expertQueueNumber,
      numbered.registrationQueueNumber,
      numbered.customerOrder?.orderQueueNumber,
    ])
      expect(value ?? 0).toBeGreaterThan(0);
    const openedCode = `O-9-2-${String(numbered.customerOrder!.orderQueueNumber).padStart(3, "0")}`;
    const openedByCode = await (
      await getLeadCustomerReporting(
        new Request(
          `http://localhost/api/lead/customer-reporting?stage=expert&month=2026-09&day=02&progress=${encodeURIComponent("已开单")}&q=${openedCode}`,
        ),
      )
    ).json();
    expect(
      openedByCode.customers.map((item: { id: string }) => item.id),
    ).toContain(customer.id);
    const wrongDay = await (
      await getLeadCustomerReporting(
        new Request(
          `http://localhost/api/lead/customer-reporting?stage=expert&month=2026-09&day=01&progress=${encodeURIComponent("已开单")}&q=${openedCode}`,
        ),
      )
    ).json();
    expect(
      wrongDay.customers.map((item: { id: string }) => item.id),
    ).not.toContain(customer.id);
    await signIn(ids.lead);
    expect((await correctAttribution(originalChannelId, "核对原始渠道后恢复")).status).toBe(200);
    await signIn(ids.berlinReception);
    expect(
      (
        await patch({
          action: "assignGroupOperator",
          userId: ids.berlinOperatorB,
        })
      ).status,
    ).toBe(200);

    await signIn(ids.berlinOperatorB);
    const correctedOperatorView = await (
      await getLeadCustomerReporting(
        new Request(
          `http://localhost/api/lead/customer-reporting?stage=expert&q=${customer.phone}`,
        ),
      )
    ).json();
    expect(
      correctedOperatorView.customers.map((item: { id: string }) => item.id),
    ).toContain(customer.id);
    await signIn(ids.berlinOperatorA);
    const formerOperatorView = await (
      await getLeadCustomerReporting(
        new Request(
          `http://localhost/api/lead/customer-reporting?stage=expert&q=${customer.phone}`,
        ),
      )
    ).json();
    expect(
      formerOperatorView.customers.map((item: { id: string }) => item.id),
    ).not.toContain(customer.id);

    const rows = await db.dailyStatEntry.findMany({
      where: {
        groupId: ids.berlinGroup,
        businessDate: "2026-09-02",
        channelId: { in: [originalChannelId, correctedChannelId] },
      },
      include: { currentRevision: true },
    });
    const sum = (
      channelId: string,
      field:
        | "operatorReceivedCount"
        | "expertIntroCount"
        | "expertReceivedCount"
        | "registrationCount"
        | "orderCount",
    ) =>
      rows
        .filter((row) => row.channelId === channelId)
        .reduce((total, row) => total + (row.currentRevision?.[field] ?? 0), 0);
    for (const field of [
      "operatorReceivedCount",
      "expertIntroCount",
      "expertReceivedCount",
      "registrationCount",
      "orderCount",
    ] as const) {
      expect(sum(correctedChannelId, field), `${field} 旧渠道必须清零`).toBe(0);
      expect(sum(originalChannelId, field), `${field} 必须搬到新渠道`).toBe(1);
    }
    expect(
      rows.find(
        (row) =>
          row.channelId === originalChannelId &&
          row.position === "GROUP_OPERATOR" &&
          row.ownerId === ids.berlinOperatorA,
      )?.currentRevision,
    ).toMatchObject({ operatorReceivedCount: 1, expertIntroCount: 1 });
    expect(
      rows
        .filter(
          (row) =>
            row.channelId === originalChannelId &&
            row.sourceReceptionId === ids.berlinReception,
        )
        .reduce(
          (total, row) =>
            total + (row.currentRevision?.operatorReceivedCount ?? 0),
          0,
        ),
    ).toBe(1);
    expect(
      rows.some(
        (row) =>
          row.sourceReceptionId === ids.berlinOperatorA ||
          row.sourceReceptionId === ids.berlinOperatorB ||
          row.sourceReceptionId === ids.berlinExpert,
      ),
    ).toBe(false);

    await signIn(ids.berlinReception);
    const personalPerformance = await (
      await import("../../src/app/api/personal-performance/route")
    ).GET(
      new Request(
        "http://localhost/api/personal-performance?role=RECEPTION&range=custom&sourceDateFrom=2026-09-02&sourceDateTo=2026-09-02",
      ),
    );
    expect(personalPerformance.status).toBe(200);
    expect((await personalPerformance.json()).funnel.summary).toMatchObject({
      joined: 1,
      pushed: 1,
      registered: 1,
      ordered: 1,
    });

    await signIn(ids.companyManager);
    const leaderboard = await getPerformanceLeaderboard(
      new Request(
        "http://localhost/api/performance-leaderboard?range=custom&sourceDateFrom=2026-09-02&sourceDateTo=2026-09-02",
      ),
    );
    expect(leaderboard.status).toBe(200);
    const leaderboardBody = await leaderboard.json();
    expect(
      leaderboardBody.receptions.find(
        (row: { id: string }) => row.id === ids.berlinReception,
      ),
    ).toMatchObject({ joined: 1, orders: 1 });

    await signIn(ids.lead);
    const leadChannel = await getLeadChannelReporting(
      new Request(
        "http://localhost/api/lead/channel-reporting?range=custom&sourceDateFrom=2026-09-02&sourceDateTo=2026-09-02",
      ),
    );
    expect(leadChannel.status).toBe(200);
    expect((await leadChannel.json()).summary.totals).toMatchObject({
      joined: 1,
      pushed: 1,
      registered: 1,
      ordered: 1,
    });
    vi.spyOn(leadMembers, "requireLeadRequest").mockResolvedValue({
      actor: await db.user.findUniqueOrThrow({ where: { id: ids.lead } }),
      group: { id: ids.berlinGroup, name: `柏林一组-${suffix}` },
    });
    const memberDaily = await getLeadMemberDailyStats(
      new Request(
        "http://localhost/api/lead/member-daily-stats/member?from=2026-09-02&to=2026-09-02",
      ),
      { params: Promise.resolve({ memberId: ids.berlinReception }) },
    );
    expect(memberDaily.status).toBe(200);
    const memberDailyBody = await memberDaily.json();
    expect(
      memberDailyBody.entries
        .filter(
          (entry: { sourceReceptionId: string | null }) =>
            entry.sourceReceptionId === ids.berlinReception,
        )
        .reduce(
          (
            total: number,
            entry: {
              currentRevision?: { operatorReceivedCount: number } | null;
            },
          ) => total + (entry.currentRevision?.operatorReceivedCount ?? 0),
          0,
        ),
    ).toBe(1);

    const order = await db.customerOrder.findUnique({
      where: { leadId: customer.id },
    });
    if (order)
      await db.customerFinanceEvent.deleteMany({
        where: { customerOrderId: order.id },
      });
    await db.customerOrder.deleteMany({ where: { leadId: customer.id } });
    await db.leadActivity.deleteMany({ where: { leadId: customer.id } });
    await db.auditLog.deleteMany({ where: { entityId: customer.id } });
    await db.leadCustomer.delete({ where: { id: customer.id } });
    const eventEntries = await db.dailyStatEntry.findMany({
      where: { groupId: ids.berlinGroup, businessDate: "2026-09-02" },
      select: { id: true },
    });
    await db.dailyStatEntry.updateMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
      data: { currentRevisionId: null, approvedRevisionId: null },
    });
    await db.dailyStatRevision.deleteMany({
      where: { entryId: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.dailyStatEntry.deleteMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.sourceBatch.deleteMany({
      where: { groupId: ids.berlinGroup, sourceDate: "2026-09-02" },
    });
    await db.channel.delete({
      where: {
        id_groupId: { id: correctedChannelId, groupId: ids.berlinGroup },
      },
    });
    vi.useRealTimers();
  });

  it("推专家按选择的发生日期统计，纠错后从旧日减一并计入新日", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T03:30:00Z"));
    const channelId = id(`expert-date-channel-${randomUUID()}`);
    await db.channel.create({
      data: {
        id: channelId,
        groupId: ids.berlinGroup,
        name: `推专家日期测试-${suffix}`,
        normalizedName: `推专家日期测试-${channelId}`,
      },
    });
    const batch = await db.sourceBatch.create({
      data: {
        groupId: ids.berlinGroup,
        channelId,
        sourceDate: "2026-09-01",
      },
    });
    const customer = await db.leadCustomer.create({
      data: {
        id: id(`expert-date-customer-${randomUUID()}`),
        phone: `${Math.floor(100000 + Math.random() * 899999)}`,
        batchId: batch.id,
        ownerId: ids.berlinReception,
        attributionOwnerId: ids.berlinReception,
        groupOperatorOwnerId: ids.berlinOperatorA,
        currentGroupId: ids.berlinGroup,
        groupStatus: "JOINED",
        joinedOn: "2026-09-01",
      },
    });
    await signIn(ids.berlinOperatorA);
    const patch = (occurredOn: string) =>
      patchSharedCustomer(
        new Request(
          `http://localhost/api/lead/customer-reporting/${customer.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "assignExpert",
              userId: ids.berlinExpert,
              occurredOn,
            }),
          },
        ),
        { params: Promise.resolve({ leadId: customer.id }) },
      );

    expect((await patch("2026-09-01")).status).toBe(200);
    const firstNumber = (
      await db.leadCustomer.findUniqueOrThrow({ where: { id: customer.id } })
    ).expertQueueNumber;
    expect((await patch("2026-09-02")).status).toBe(200);
    const corrected = await db.leadCustomer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(corrected.expertIntroducedOn).toBe("2026-09-02");
    // 每个日期各自从 001 起排号；跨日纠错后流水号可能仍是 001，日期才是编号的一部分。
    expect(firstNumber ?? 0).toBeGreaterThan(0);
    expect(corrected.expertQueueNumber ?? 0).toBeGreaterThan(0);

    const eventEntries = await db.dailyStatEntry.findMany({
      where: { channelId },
      include: { currentRevision: true },
    });
    const total = (
      date: string,
      metric: "expertIntroCount" | "expertReceivedCount",
    ) =>
      eventEntries
        .filter((entry) => entry.businessDate === date)
        .reduce(
          (sum, entry) => sum + (entry.currentRevision?.[metric] ?? 0),
          0,
        );
    for (const metric of ["expertIntroCount", "expertReceivedCount"] as const) {
      expect(total("2026-09-01", metric)).toBe(0);
      expect(total("2026-09-02", metric)).toBe(1);
    }

    await db.leadActivity.deleteMany({ where: { leadId: customer.id } });
    await db.auditLog.deleteMany({ where: { entityId: customer.id } });
    await db.leadCustomer.delete({ where: { id: customer.id } });
    await db.dailyStatEntry.updateMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
      data: { currentRevisionId: null, approvedRevisionId: null },
    });
    await db.dailyStatRevision.deleteMany({
      where: { entryId: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.dailyStatEntry.deleteMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.sourceBatch.delete({ where: { id: batch.id } });
    await db.channel.delete({
      where: { id_groupId: { id: channelId, groupId: ids.berlinGroup } },
    });
    vi.useRealTimers();
  });

  it("员工保存后正式版本能立刻出现在组长和部门汇总中", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    const channelId = id("berlin-channel");
    const entry = await db.dailyStatEntry.create({
      data: {
        identityKey: `pending-visible-${suffix}`,
        ownerId: ids.lead,
        groupId: ids.berlinGroup,
        channelId,
        businessDate: "2026-09-01",
        timezone: "Europe/Berlin",
        position: "RECEPTION",
        status: "APPROVED",
      },
    });
    const revision = await db.dailyStatRevision.create({
      data: {
        entryId: entry.id,
        version: 1,
        createdById: ids.lead,
        dispatchCount: 5,
        effectiveCount: 5,
        replyCount: 2,
      },
    });
    await db.dailyStatEntry.update({
      where: { id: entry.id },
      data: { currentRevisionId: revision.id, approvedRevisionId: revision.id },
    });
    try {
      await signIn(ids.lead);
      const response = await getLeadChannelReporting(
        new Request("http://localhost/api/lead/channel-reporting?range=today"),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.summary).toMatchObject({
        totals: { added: 8, effective: 7, replied: 3 },
      });
      expect(body).not.toHaveProperty("review");

      await signIn(ids.departmentManager);
      const departmentBody = await (
        await getOrgReporting(request("range=today"))
      ).json();
      expect(
        departmentBody.groups.find(
          (group: { id: string }) => group.id === ids.berlinGroup,
        ),
      ).toMatchObject({ totals: { added: 8, effective: 7, replied: 3 } });
      const channelBody = await (
        await getOrgChannelReporting(
          new Request(
            `http://localhost/api/org/channel-reporting?range=today&groupId=${ids.berlinGroup}`,
          ),
        )
      ).json();
      expect(channelBody.rows).toEqual([
        expect.objectContaining({
          totals: expect.objectContaining({
            added: 8,
            effective: 7,
            replied: 3,
          }),
        }),
      ]);

      await signIn(ids.resource);
      const resourceBody = await (
        await getResourceReporting(
          new Request("http://localhost/api/resource/reporting?range=today"),
        )
      ).json();
      expect(
        resourceBody.rows.find(
          (row: { group: { id: string } }) => row.group.id === ids.berlinGroup,
        ),
      ).toMatchObject({ totals: { added: 8, effective: 7, replied: 3 } });
    } finally {
      await db.dailyStatEntry.delete({ where: { id: entry.id } });
      vi.useRealTimers();
    }
  });

  it("渠道区间内没有任何新记录时，仍按业务线延续此前最近快照", async () => {
    await signIn(ids.lead);
    const response = await getLeadChannelReporting(
      new Request(
        "http://localhost/api/lead/channel-reporting?range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31",
      ),
    );
    const body = await response.json();
    expect(body.rows[0]).toMatchObject({ totals: { inGroup: 17 } });
    expect(body.members).toEqual([
      expect.objectContaining({
        id: ids.berlinReception,
        totals: expect.objectContaining({ inGroup: 17 }),
      }),
    ]);
    expect(body.days).toEqual([]);
  });

  it("组长只能读取自己的渠道，并按本组当地日期计算今日", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.lead);
    const response = await getLeadChannelReporting(
      new Request("http://localhost/api/lead/channel-reporting?range=today"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.group).toMatchObject({
      id: ids.berlinGroup,
      timezone: "Europe/Berlin",
    });
    expect(body.range).toMatchObject({
      today: "2026-09-01",
      from: "2026-09-01",
      to: "2026-09-01",
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      name: "柏林渠道",
      totals: { added: 3, effective: 2, replied: 1 },
    });
    expect(body.rows[0].members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.berlinReception,
          name: expect.any(String),
          totals: expect.objectContaining({
            added: 3,
            effective: 2,
            replied: 1,
          }),
        }),
      ]),
    );
    expect(body.summary).toMatchObject({
      name: "全组",
      // 9 月起不再延续 8 月手工快照；没有真实在群客户就是 0。
      totals: { added: 3, effective: 2, replied: 1, inGroup: 0 },
      derivedRates: { effectiveRate: 2 / 3, replyRate: 1 / 2 },
    });
    expect(
      body.members.find(
        (member: { id: string }) => member.id === ids.berlinReception,
      ),
    ).toMatchObject({
      totals: { added: 3, effective: 2, replied: 1 },
      channels: [
        expect.objectContaining({
          name: "柏林渠道",
          totals: expect.objectContaining({ added: 3, effective: 2 }),
        }),
      ],
    });
    expect(body.analysis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tone: "info",
          title: "柏林渠道 贡献净业绩最多",
        }),
      ]),
    );
    expect(body.days).toEqual([
      expect.objectContaining({
        date: "2026-09-01",
        summary: expect.objectContaining({
          name: "2026-09-01",
          totals: expect.objectContaining({
            added: 3,
            effective: 2,
            replied: 1,
          }),
        }),
        rows: [
          expect.objectContaining({
            name: "柏林渠道",
            totals: expect.objectContaining({
              added: 3,
              effective: 2,
              replied: 1,
            }),
          }),
        ],
      }),
    ]);
  });

  it("非组长不能借该接口读取渠道明细", async () => {
    await signIn(ids.departmentManager);
    expect(
      (
        await getLeadChannelReporting(
          new Request(
            "http://localhost/api/lead/channel-reporting?range=month",
          ),
        )
      ).status,
    ).toBe(403);
  });
});

describe.sequential("组织管理员小组渠道报表 API", () => {
  it("组织渠道汇总延续每条业务线在截止日前的最近快照", async () => {
    await signIn(ids.departmentManager);
    const response = await getOrgChannelReporting(
      new Request(
        `http://localhost/api/org/channel-reporting?range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31&groupId=${ids.berlinGroup}`,
      ),
    );
    expect(await response.json()).toMatchObject({
      rows: [
        expect.objectContaining({
          totals: expect.objectContaining({ inGroup: 17 }),
        }),
      ],
    });
  });

  it("部门管理员只能读取本部门小组，公司管理员可以读取本公司跨部门小组", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.departmentManager);
    const own = await getOrgChannelReporting(
      new Request(
        `http://localhost/api/org/channel-reporting?range=today&groupId=${ids.berlinGroup}`,
      ),
    );
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      group: { id: ids.berlinGroup },
      rows: [
        expect.objectContaining({
          name: "柏林渠道",
          totals: expect.objectContaining({ added: 3 }),
        }),
      ],
      days: [
        expect.objectContaining({
          date: "2026-09-01",
          rows: [
            expect.objectContaining({
              name: "柏林渠道",
              totals: expect.objectContaining({ added: 3 }),
            }),
          ],
        }),
      ],
    });
    expect(
      (
        await getOrgChannelReporting(
          new Request(
            `http://localhost/api/org/channel-reporting?range=today&groupId=${ids.newYorkGroup}`,
          ),
        )
      ).status,
    ).toBe(403);

    await signIn(ids.companyManager);
    expect(
      (
        await getOrgChannelReporting(
          new Request(
            `http://localhost/api/org/channel-reporting?range=today&groupId=${ids.newYorkGroup}`,
          ),
        )
      ).status,
    ).toBe(200);
  });

  it("资源部不能借组织管理员接口读取渠道明细", async () => {
    await signIn(ids.resource);
    expect(
      (
        await getOrgChannelReporting(
          new Request(
            `http://localhost/api/org/channel-reporting?range=month&groupId=${ids.berlinGroup}`,
          ),
        )
      ).status,
    ).toBe(403);
  });
});

describe.sequential("资源部真实报表快照", () => {
  it("资源账号只返回明确授权的渠道，并且不能读取或修改客户进度", async () => {
    await signIn(ids.resource);
    const reporting = await getResourceReporting(
      new Request("http://localhost/api/resource/reporting?range=month"),
    );
    expect(reporting.status).toBe(200);
    const body = await reporting.json();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(
      body.rows.every(
        (row: { channel: { id: string } }) =>
          row.channel.id === id("berlin-channel"),
      ),
    ).toBe(true);
    expect(
      (
        await getLeadCustomerReporting(
          new Request(
            `http://localhost/api/lead/customer-reporting?stage=group&groupId=${ids.berlinGroup}`,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await patchSharedCustomer(
          new Request(
            `http://localhost/api/lead/customer-reporting/${id("customer-group")}`,
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "setDeviceCode",
                code: "越权设备",
              }),
            },
          ),
          { params: Promise.resolve({ leadId: id("customer-group") }) },
        )
      ).status,
    ).toBe(403);
  });

  it("资源汇总延续每条业务线在截止日前的最近快照", async () => {
    await signIn(ids.resource);
    const response = await getResourceReporting(
      new Request(
        "http://localhost/api/resource/reporting?range=custom&sourceDateFrom=2026-08-31&sourceDateTo=2026-08-31",
      ),
    );
    expect(await response.json()).toMatchObject({
      rows: [
        expect.objectContaining({
          totals: expect.objectContaining({ inGroup: 17 }),
        }),
      ],
    });
  });

  it("资源部按人员查看时，下游进度和资金仍归最初接粉组员", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    await signIn(ids.resource);
    const response = await getResourceReporting(
      new Request("http://localhost/api/resource/reporting?range=today"),
    );
    const body = await response.json();
    const attributed = body.memberRows.find(
      (row: { member: { id: string }; channelId: string }) =>
        row.member.id === ids.berlinReception &&
        row.channelId === id("berlin-channel"),
    );
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
    expect(
      body.memberRows.some(
        (row: {
          member: { id: string };
          totals: { registered: number; ordered: number };
        }) =>
          [ids.berlinOperatorB, ids.berlinExpert].includes(row.member.id) &&
          (row.totals.registered > 0 || row.totals.ordered > 0),
      ),
    ).toBe(false);
  });
});

describe.sequential("新版客户进度 API", () => {
  it("历史接粉和历史进群可以恢复号码，但不会补写旧月份统计", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T03:30:00Z"));
    const channelId = id("historical-resume-channel");
    await db.channel.create({
      data: {
        id: channelId,
        groupId: ids.berlinGroup,
        name: `历史续接渠道-${suffix}`,
        normalizedName: `历史续接渠道-${suffix}`,
      },
    });
    await signIn(ids.berlinReception);
    const response = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          attributionOwnerId: ids.berlinReception,
          phone: "839903",
          channelId,
          sourceDate: "2026-08-24",
          joinedOn: "2026-08-30",
          groupOperatorOwnerId: ids.berlinOperatorA,
          deviceCode: "历史续接设备",
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      id: string;
      resumed: boolean;
      counted: { join: boolean; expert: boolean };
    };
    expect(body).toMatchObject({
      resumed: true,
      counted: { join: false, expert: false },
    });
    await expect(
      db.leadCustomer.findUniqueOrThrow({ where: { id: body.id } }),
    ).resolves.toMatchObject({
      isHistoricalRecord: true,
      historicalBaselineStage: "JOINED",
      historicalJoinCounted: false,
      historicalExpertIntroCounted: false,
      joinedOn: "2026-08-30",
    });
    expect(await db.dailyStatEntry.count({ where: { channelId } })).toBe(0);

    await db.leadActivity.deleteMany({ where: { leadId: body.id } });
    await db.auditLog.deleteMany({ where: { entityId: body.id } });
    await db.leadCustomer.delete({ where: { id: body.id } });
    await db.device.deleteMany({
      where: { groupId: ids.berlinGroup, code: "历史续接设备" },
    });
    await db.sourceBatch.deleteMany({
      where: { groupId: ids.berlinGroup, channelId },
    });
    await db.channel.delete({
      where: { id_groupId: { id: channelId, groupId: ids.berlinGroup } },
    });
    vi.useRealTimers();
  });

  it("9月起组长和管理层的当前在群直接读取客户进度真相，不叠加旧快照", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T03:30:00Z"));
    const batch = await db.sourceBatch.findFirstOrThrow({
      where: { groupId: ids.berlinGroup, channelId: id("berlin-channel") },
    });
    const customer = await db.leadCustomer.create({
      data: {
        phone: `current-${suffix}`,
        batchId: batch.id,
        ownerId: ids.berlinReception,
        attributionOwnerId: ids.berlinReception,
        groupOperatorOwnerId: ids.berlinOperatorA,
        groupStatus: "JOINED",
        joinedOn: "2026-09-01",
      },
    });
    try {
      await signIn(ids.lead);
      const leadBody = await (
        await getLeadChannelReporting(new Request("http://localhost/api/lead/channel-reporting?range=today"))
      ).json();
      expect(leadBody.summary.totals.inGroup).toBe(1);
      expect(leadBody.rows[0].totals.inGroup).toBe(1);

      const orgBody = await getOrgReporting(request("range=today")).then((response) => response.json());
      expect(orgBody.groups.find((group: { id: string }) => group.id === ids.berlinGroup)?.totals.inGroup).toBe(1);
      expect(orgBody.members.find((member: { id: string }) => member.id === ids.berlinReception)?.totals.inGroup).toBe(1);
    } finally {
      await db.leadCustomer.delete({ where: { id: customer.id } });
      vi.useRealTimers();
    }
  });

  it("进群统计按客户真相幂等对账，改日期、改渠道和撤销都会搬走原数字", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T03:30:00Z"));
    const originalChannelId = id("join-reconcile-original-channel");
    const correctedChannelId = id("join-reconcile-corrected-channel");
    await db.channel.createMany({
      data: [
        {
          id: originalChannelId,
          groupId: ids.berlinGroup,
          name: `进群对账原渠道-${suffix}`,
          normalizedName: `进群对账原渠道-${suffix}`,
        },
        {
          id: correctedChannelId,
          groupId: ids.berlinGroup,
          name: `进群对账新渠道-${suffix}`,
          normalizedName: `进群对账新渠道-${suffix}`,
        },
      ],
    });
    const originalBatch = await db.sourceBatch.create({
      data: {
        groupId: ids.berlinGroup,
        channelId: originalChannelId,
        sourceDate: "2026-08-31",
        isHistoricalRecord: true,
      },
    });
    const correctedBatch = await db.sourceBatch.create({
      data: {
        groupId: ids.berlinGroup,
        channelId: correctedChannelId,
        sourceDate: "2026-08-31",
        isHistoricalRecord: true,
      },
    });
    const customer = await db.leadCustomer.create({
      data: {
        phone: "839904",
        batchId: originalBatch.id,
        ownerId: ids.berlinReception,
        attributionOwnerId: ids.berlinReception,
        groupOperatorOwnerId: ids.berlinOperatorA,
        invalid: false,
        isHistoricalRecord: true,
        historicalJoinCounted: true,
        groupStatus: "JOINED",
        joinedOn: "2026-09-01",
        activities: {
          create: {
            actorId: ids.berlinOperatorA,
            kind: "JOINED_GROUP",
            occurredOn: "2026-09-01",
          },
        },
      },
    });
    const tracked = (channelId: string) => ({
      phone: customer.phone,
      ownerId: ids.berlinReception,
      attributionOwnerId: ids.berlinReception,
      groupOperatorOwnerId: ids.berlinOperatorA,
      expertOwnerId: null,
      batch: { groupId: ids.berlinGroup, channelId },
    });
    const joinTotal = async (channelId: string, businessDate: string) => {
      const entries = await db.dailyStatEntry.findMany({
        where: {
          groupId: ids.berlinGroup,
          channelId,
          businessDate,
          position: "GROUP_OPERATOR",
          sourceReceptionId: ids.berlinReception,
        },
        include: { currentRevision: true },
      });
      return entries.reduce(
        (sum, entry) => sum + (entry.currentRevision?.operatorReceivedCount ?? 0),
        0,
      );
    };

    await db.$transaction((tx) =>
      syncCustomerGroupEvent(tx, tracked(originalChannelId), {
        businessDate: "2026-09-01",
        kind: "JOIN",
      }),
    );
    // 同一个动作再次到达时不再 +1。
    await db.$transaction((tx) =>
      syncCustomerGroupEvent(tx, tracked(originalChannelId), {
        businessDate: "2026-09-01",
        kind: "JOIN",
      }),
    );
    expect(await joinTotal(originalChannelId, "2026-09-01")).toBe(1);

    await db.leadCustomer.update({
      where: { id: customer.id },
      data: { joinedOn: "2026-09-02" },
    });
    await db.$transaction(async (tx) => {
      await syncCustomerGroupEvent(tx, tracked(originalChannelId), {
        businessDate: "2026-09-01",
        kind: "JOIN",
        delta: -1,
      });
      await syncCustomerGroupEvent(tx, tracked(originalChannelId), {
        businessDate: "2026-09-02",
        kind: "JOIN",
      });
    });
    expect(await joinTotal(originalChannelId, "2026-09-01")).toBe(0);
    expect(await joinTotal(originalChannelId, "2026-09-02")).toBe(1);

    await db.leadCustomer.update({
      where: { id: customer.id },
      data: { batchId: correctedBatch.id },
    });
    await db.$transaction(async (tx) => {
      await syncCustomerGroupEvent(tx, tracked(originalChannelId), {
        businessDate: "2026-09-02",
        kind: "JOIN",
        delta: -1,
      });
      await syncCustomerGroupEvent(tx, tracked(correctedChannelId), {
        businessDate: "2026-09-02",
        kind: "JOIN",
      });
    });
    expect(await joinTotal(originalChannelId, "2026-09-02")).toBe(0);
    expect(await joinTotal(correctedChannelId, "2026-09-02")).toBe(1);

    await db.leadCustomer.update({
      where: { id: customer.id },
      data: {
        groupStatus: "NOT_JOINED",
        joinedOn: null,
        historicalJoinCounted: false,
      },
    });
    await db.$transaction((tx) =>
      syncCustomerGroupEvent(tx, tracked(correctedChannelId), {
        businessDate: "2026-09-02",
        kind: "JOIN",
        delta: -1,
      }),
    );
    expect(await joinTotal(correctedChannelId, "2026-09-02")).toBe(0);

    const eventEntries = await db.dailyStatEntry.findMany({
      where: { channelId: { in: [originalChannelId, correctedChannelId] } },
      select: { id: true },
    });
    await db.leadActivity.deleteMany({ where: { leadId: customer.id } });
    await db.leadCustomer.delete({ where: { id: customer.id } });
    await db.dailyStatEntry.updateMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
      data: { currentRevisionId: null, approvedRevisionId: null },
    });
    await db.dailyStatRevision.deleteMany({
      where: { entryId: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.dailyStatEntry.deleteMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.sourceBatch.deleteMany({
      where: { id: { in: [originalBatch.id, correctedBatch.id] } },
    });
    await db.channel.deleteMany({
      where: { id: { in: [originalChannelId, correctedChannelId] } },
    });
    vi.useRealTimers();
  });

  it("炒群负责人可登记遗失号码的推专家进度，并按真实日期生成 G/E 编号和两段统计", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T03:30:00Z"));
    const channelId = id("expert-direct-create-channel");
    await db.channel.create({
      data: {
        id: channelId,
        groupId: ids.berlinGroup,
        name: `专家新增渠道-${suffix}`,
        normalizedName: `专家新增渠道-${suffix}`,
      },
    });
    const body = {
      attributionOwnerId: ids.berlinReception,
      phone: "839902",
      channelId,
      sourceDate: "2026-08-24",
      joinedOn: "2026-08-30",
      groupOperatorOwnerId: ids.berlinOperatorA,
      deviceCode: "专家新增设备",
      expertOwnerId: ids.berlinExpert,
      expertIntroducedOn: "2026-09-02",
    };

    await signIn(ids.berlinReception);
    const forbidden = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(forbidden.status).toBe(403);

    await signIn(ids.berlinExpert);
    const expertForbidden = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(expertForbidden.status).toBe(403);

    await signIn(ids.berlinOperatorA);
    const invalidReception = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, attributionOwnerId: ids.berlinExpert }),
      }),
    );
    expect(invalidReception.status).toBe(400);
    const invalidOperator = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, groupOperatorOwnerId: ids.berlinExpert }),
      }),
    );
    expect(invalidOperator.status).toBe(400);
    const invalidExpert = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, expertOwnerId: ids.berlinOperatorB }),
      }),
    );
    expect(invalidExpert.status).toBe(400);
    const response = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(201);
    const customer = (await response.json()) as { id: string };
    await expect(
      db.leadCustomer.findUniqueOrThrow({ where: { id: customer.id } }),
    ).resolves.toMatchObject({
      ownerId: ids.berlinReception,
      attributionOwnerId: ids.berlinReception,
      groupOperatorOwnerId: ids.berlinOperatorA,
      expertOwnerId: ids.berlinExpert,
      joinedOn: "2026-08-30",
      expertIntroducedOn: "2026-09-02",
      groupQueueNumber: expect.any(Number),
      expertQueueNumber: expect.any(Number),
      isHistoricalRecord: true,
      historicalBaselineStage: "JOINED",
      historicalJoinCounted: false,
      historicalExpertIntroCounted: true,
    });

    const eventEntries = await db.dailyStatEntry.findMany({
      where: { channelId },
      include: { currentRevision: true },
    });
    const sum = (date: string, field: "operatorReceivedCount" | "expertIntroCount" | "expertReceivedCount") =>
      eventEntries
        .filter((entry) => entry.businessDate === date)
        .reduce((total, entry) => total + (entry.currentRevision?.[field] ?? 0), 0);
    expect(sum("2026-08-30", "operatorReceivedCount")).toBe(0);
    expect(sum("2026-09-02", "expertIntroCount")).toBe(1);
    expect(sum("2026-09-02", "expertReceivedCount")).toBe(1);
    expect(
      eventEntries.every(
        (entry) =>
          !entry.sourceReceptionId ||
          entry.sourceReceptionId === ids.berlinReception,
      ),
    ).toBe(true);

    await db.leadActivity.deleteMany({ where: { leadId: customer.id } });
    await db.auditLog.deleteMany({ where: { entityId: customer.id } });
    await db.leadCustomer.delete({ where: { id: customer.id } });
    await db.dailyStatEntry.updateMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
      data: { currentRevisionId: null, approvedRevisionId: null },
    });
    await db.dailyStatRevision.deleteMany({
      where: { entryId: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.dailyStatEntry.deleteMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.device.deleteMany({
      where: { groupId: ids.berlinGroup, code: "专家新增设备" },
    });
    await db.sourceBatch.deleteMany({
      where: { groupId: ids.berlinGroup, channelId },
    });
    await db.channel.delete({
      where: { id_groupId: { id: channelId, groupId: ids.berlinGroup } },
    });
    vi.useRealTimers();
  });

  it("公司管理员可以查看范围内客户，但不能代录或修改客户数据", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T03:30:00Z"));
    const channelId = id("manager-proxy-channel");
    await db.channel.create({
      data: {
        id: channelId,
        groupId: ids.berlinGroup,
        name: `管理员代录渠道-${suffix}`,
        normalizedName: `管理员代录渠道-${suffix}`,
      },
    });
    await signIn(ids.companyManager);
    const missingOwner = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: ids.berlinGroup,
          phone: "839901",
          channelId,
          sourceDate: "2026-09-02",
          joinedOn: "2026-09-02",
          groupOperatorOwnerId: ids.berlinOperatorA,
          deviceCode: "管理员代录设备",
        }),
      }),
    );
    expect(missingOwner.status).toBe(403);

    const saved = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: ids.berlinGroup,
          attributionOwnerId: ids.berlinReception,
          phone: "839901",
          channelId,
          sourceDate: "2026-09-02",
          joinedOn: "2026-09-02",
          groupOperatorOwnerId: ids.berlinOperatorA,
          deviceCode: "管理员代录设备",
        }),
      }),
    );
    expect(saved.status).toBe(403);
    const eventEntries = await db.dailyStatEntry.findMany({
      where: { channelId },
      select: { id: true },
    });
    expect(eventEntries).toEqual([]);
    await db.dailyStatEntry.updateMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
      data: { currentRevisionId: null, approvedRevisionId: null },
    });
    await db.dailyStatRevision.deleteMany({
      where: { entryId: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.dailyStatEntry.deleteMany({
      where: { id: { in: eventEntries.map((entry) => entry.id) } },
    });
    await db.sourceBatch.deleteMany({
      where: { groupId: ids.berlinGroup, channelId },
    });
    await db.channel.delete({
      where: { id_groupId: { id: channelId, groupId: ids.berlinGroup } },
    });
    vi.useRealTimers();
  });

  it("批量新增先预检号码，再统一保存有效客户并跳过重复和错误号码", async () => {
    await signIn(ids.berlinReception);
    const body = {
      phones: ["+1 725 830001", "830002", "830002", "12"],
      channelId: id("berlin-channel"),
      sourceDate: "2026-09-01",
      joinedOn: "2026-09-02",
      groupOperatorOwnerId: ids.berlinOperatorA,
      deviceCode: "批量设备-B08",
    };
    const call = (dryRun: boolean) =>
      postLeadCustomerReporting(
        new Request("http://localhost/api/lead/customer-reporting", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, dryRun }),
        }),
      );

    const historicalPreview = await postLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          sourceDate: "2026-08-30",
          joinedOn: "2026-08-31",
          dryRun: true,
        }),
      }),
    );
    expect(historicalPreview.status).toBe(200);
    expect(await historicalPreview.json()).toMatchObject({
      validPhones: ["830001", "830002"],
      duplicates: ["830002"],
      invalid: ["12"],
    });

    const preview = await call(true);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      validPhones: ["830001", "830002"],
      duplicates: ["830002"],
      invalid: ["12"],
      totalInput: 4,
    });

    const saved = await call(false);
    expect(saved.status).toBe(201);
    expect(await saved.json()).toMatchObject({
      created: [{ phone: "830001" }, { phone: "830002" }],
      duplicates: ["830002"],
      invalid: ["12"],
    });
    expect(
      await db.leadCustomer.count({
        where: {
          phone: { in: ["830001", "830002"] },
          ownerId: ids.berlinReception,
          attributionOwnerId: ids.berlinReception,
          groupStatus: "JOINED",
          groupOperatorOwnerId: ids.berlinOperatorA,
          device: { code: "批量设备-B08" },
          batch: { sourceDate: "2026-09-01" },
        },
      }),
    ).toBe(2);

    const repeatedPreview = await call(true);
    expect(await repeatedPreview.json()).toMatchObject({
      validPhones: [],
      duplicates: expect.arrayContaining(["830001", "830002"]),
      invalid: ["12"],
    });
    await db.leadCustomer.deleteMany({
      where: { phone: { in: ["830001", "830002"] } },
    });
  });

  it("按接粉、炒群、专家阶段读取本组真实客户并返回分页数量", async () => {
    const device = await db.device.create({
      data: {
        id: id("customer-device"),
        code: "B-22",
        groupId: ids.berlinGroup,
        memberId: ids.berlinReception,
      },
    });
    await db.leadCustomer.createMany({
      data: [
        {
          id: id("customer-pending-reply"),
          phone: `40${suffix.replaceAll("-", "").slice(0, 10)}`,
          batchId: (
            await db.sourceBatch.findFirstOrThrow({
              where: { groupId: ids.berlinGroup },
            })
          ).id,
          ownerId: ids.berlinReception,
        },
        {
          id: id("customer-reception"),
          phone: `41${suffix.replaceAll("-", "").slice(0, 10)}`,
          batchId: (
            await db.sourceBatch.findFirstOrThrow({
              where: { groupId: ids.berlinGroup },
            })
          ).id,
          ownerId: ids.berlinReception,
          repliedOn: "2026-07-02",
          replyStatus: "REPLIED",
        },
        {
          id: id("customer-archived"),
          phone: `44${suffix.replaceAll("-", "").slice(0, 10)}`,
          batchId: (
            await db.sourceBatch.findFirstOrThrow({
              where: { groupId: ids.berlinGroup },
            })
          ).id,
          ownerId: ids.berlinReception,
          repliedOn: "2026-07-02",
          replyStatus: "REPLIED",
          receptionArchivedAt: new Date("2026-07-05T12:00:00Z"),
          receptionArchiveReason: "历史归档",
          receptionArchiveVisitCount: 2,
        },
        {
          id: id("customer-group"),
          phone: `42${suffix.replaceAll("-", "").slice(0, 10)}`,
          batchId: (
            await db.sourceBatch.findFirstOrThrow({
              where: { groupId: ids.berlinGroup },
            })
          ).id,
          ownerId: ids.berlinReception,
          deviceId: device.id,
          repliedOn: "2026-07-02",
          replyStatus: "REPLIED",
          groupStatus: "JOINED",
          joinedOn: "2026-07-03",
        },
        {
          id: id("customer-expert"),
          phone: `43${suffix.replaceAll("-", "").slice(0, 10)}`,
          batchId: (
            await db.sourceBatch.findFirstOrThrow({
              where: { groupId: ids.berlinGroup },
            })
          ).id,
          ownerId: ids.berlinReception,
          repliedOn: "2026-07-02",
          replyStatus: "REPLIED",
          groupStatus: "JOINED",
          joinedOn: "2026-07-03",
          expertIntroducedOn: "2026-07-04",
        },
      ],
    });
    const expertCustomer = await db.leadCustomer.findUniqueOrThrow({
      where: { id: id("customer-expert") },
    });
    await db.leadCustomer.createMany({
      data: [
        {
          id: id("customer-expert-materials"),
          phone: `731${suffix.slice(0, 6)}`,
          batchId: expertCustomer.batchId,
          ownerId: expertCustomer.ownerId,
          attributionOwnerId: expertCustomer.attributionOwnerId,
          groupStatus: "JOINED",
          joinedOn: "2026-07-02",
          expertIntroducedOn: "2026-07-03",
          expertWorkflowStage: "MATERIALS",
        },
        {
          id: id("customer-expert-tracking"),
          phone: `732${suffix.slice(0, 6)}`,
          batchId: expertCustomer.batchId,
          ownerId: expertCustomer.ownerId,
          attributionOwnerId: expertCustomer.attributionOwnerId,
          groupStatus: "JOINED",
          joinedOn: "2026-07-02",
          expertIntroducedOn: "2026-07-03",
          expertWorkflowStage: "TRACKING",
        },
      ],
    });
    const order = await db.customerOrder.create({
      data: {
        id: id("customer-order"),
        phone: expertCustomer.phone,
        batchId: expertCustomer.batchId,
        leadId: expertCustomer.id,
        enteredById: ids.lead,
        openedOn: "2026-07-06",
        initialDepositCents: 10_000,
      },
    });
    await db.customerFinanceEvent.createMany({
      data: [
        {
          batchId: expertCustomer.batchId,
          enteredById: ids.lead,
          occurredOn: "2026-07-06",
          kind: "RECHARGE",
          amountCents: 10_000,
          customerOrderId: order.id,
        },
        {
          batchId: expertCustomer.batchId,
          enteredById: ids.lead,
          occurredOn: "2026-07-07",
          kind: "RECHARGE",
          amountCents: 2_500,
          continuationNumber: 1,
          customerOrderId: order.id,
        },
        {
          batchId: expertCustomer.batchId,
          enteredById: ids.lead,
          occurredOn: "2026-07-08",
          kind: "WITHDRAWAL",
          amountCents: 500,
          customerOrderId: order.id,
        },
      ],
    });
    await signIn(ids.lead);
    const reception = await (
      await getLeadCustomerReporting(
        new Request(
          "http://localhost/api/lead/customer-reporting?stage=reception",
        ),
      )
    ).json();
    const group = await (
      await getLeadCustomerReporting(
        new Request("http://localhost/api/lead/customer-reporting?stage=group"),
      )
    ).json();
    const pendingExpert = await (
      await getLeadCustomerReporting(
        new Request(
          "http://localhost/api/lead/customer-reporting?stage=pending-expert",
        ),
      )
    ).json();
    const expert = await (
      await getLeadCustomerReporting(
        new Request(
          "http://localhost/api/lead/customer-reporting?stage=expert",
        ),
      )
    ).json();
    const orderedExperts = await (
      await getLeadCustomerReporting(
        new Request(
          "http://localhost/api/lead/customer-reporting?stage=expert&expertStage=ORDERED",
        ),
      )
    ).json();
    const followingExperts = await (
      await getLeadCustomerReporting(
        new Request(
          "http://localhost/api/lead/customer-reporting?stage=expert&expertStage=FOLLOWING",
        ),
      )
    ).json();
    expect(reception.counts).toMatchObject({
      reception: 2,
      group: 4,
      "pending-expert": 1,
      expert: 3,
    });
    expect(
      reception.customers.map((customer: { id: string }) => customer.id),
    ).toContain(id("customer-pending-reply"));
    expect(
      reception.customers.map((customer: { id: string }) => customer.id),
    ).toContain(id("customer-reception"));
    expect(
      reception.customers.map((customer: { id: string }) => customer.id),
    ).not.toContain(id("customer-archived"));
    expect(
      group.customers.map((customer: { id: string }) => customer.id),
    ).toEqual(
      expect.arrayContaining([id("customer-group"), id("customer-expert")]),
    );
    expect(
      pendingExpert.customers.map((customer: { id: string }) => customer.id),
    ).toContain(id("customer-group"));
    expect(
      pendingExpert.customers.map((customer: { id: string }) => customer.id),
    ).not.toContain(id("customer-expert"));
    expect(
      group.customers.find(
        (customer: { id: string }) => customer.id === id("customer-group"),
      ).device,
    ).toEqual({ id: device.id, code: "B-22" });
    expect(group.channels).toContain("柏林渠道");
    expect(group.summary).toMatchObject({
      customerCount: 4,
      orderCount: 1,
      initialDepositCents: 10_000,
      rechargeCents: 2_500,
      withdrawalCents: 500,
    });
    const unmatchedChannel = await (
      await getLeadCustomerReporting(
        new Request(
          "http://localhost/api/lead/customer-reporting?stage=group&channel=不存在的渠道",
        ),
      )
    ).json();
    expect(unmatchedChannel).toMatchObject({
      total: 0,
      summary: {
        customerCount: 0,
        orderCount: 0,
        initialDepositCents: 0,
        rechargeCents: 0,
        withdrawalCents: 0,
      },
    });
    const unmatchedMember = await (
      await getLeadCustomerReporting(
        new Request(
          "http://localhost/api/lead/customer-reporting?stage=group&memberId=不存在的组员",
        ),
      )
    ).json();
    expect(unmatchedMember).toMatchObject({
      total: 0,
      summary: {
        customerCount: 0,
        orderCount: 0,
        initialDepositCents: 0,
        rechargeCents: 0,
        withdrawalCents: 0,
      },
    });
    expect(
      expert.customers.map((customer: { id: string }) => customer.id),
    ).toContain(id("customer-expert"));
    expect(expert.expertCounts).toMatchObject({
      ORDERED: 1,
      QUEUED: 0,
      MATERIALS: 1,
      TRACKING: 1,
      PENDING_ORDER: 0,
    });
    expect(followingExperts.expertStage).toBe("FOLLOWING");
    expect(
      followingExperts.customers.map(
        (customer: { expertWorkflowStage: string }) =>
          customer.expertWorkflowStage,
      ),
    ).toEqual(expect.arrayContaining(["MATERIALS", "TRACKING"]));
    expect(followingExperts.customers).toHaveLength(2);
    expect(orderedExperts.expertStage).toBe("ORDERED");
    expect(
      orderedExperts.customers.map((customer: { id: string }) => customer.id),
    ).toEqual([id("customer-expert")]);
    expect(
      expert.customers.find(
        (customer: { id: string }) => customer.id === id("customer-expert"),
      ).order,
    ).toMatchObject({
      initialDepositCents: 10_000,
      rechargeCents: 2_500,
      withdrawalCents: 500,
      nextContinuationNumber: 2,
    });
  });

  it("接粉只能读取本人客户；公司管理员必须明确选择权限内小组", async () => {
    await signIn(ids.berlinReception);
    const self = await getLeadCustomerReporting(
      new Request("http://localhost/api/lead/customer-reporting?stage=group"),
    );
    expect(self.status).toBe(200);
    expect(
      (await self.json()).customers.every(
        (customer: { owner: { id: string } }) =>
          customer.owner.id === ids.berlinReception,
      ),
    ).toBe(true);
    expect(
      (
        await getLeadCustomerReporting(
          new Request(
            `http://localhost/api/lead/customer-reporting?stage=group&groupId=${ids.newYorkGroup}`,
          ),
        )
      ).status,
    ).toBe(403);

    await signIn(ids.companyManager);
    expect(
      (
        await getLeadCustomerReporting(
          new Request(
            "http://localhost/api/lead/customer-reporting?stage=expert",
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await getLeadCustomerReporting(
          new Request(
            `http://localhost/api/lead/customer-reporting?stage=expert&groupId=${ids.berlinGroup}`,
          ),
        )
      ).status,
    ).toBe(200);
  });

  it("普通组员只读取有接粉、炒群或专家配合关系的客户，人员下拉仍保留全组候选人", async () => {
    const batch = await db.sourceBatch.findFirstOrThrow({
      where: { groupId: ids.berlinGroup },
      select: { id: true },
    });
    const names = {
      ownerOnly: `仅接粉关系-${suffix}`,
      operatorRelated: `炒群配合关系-${suffix}`,
      expertRelated: `专家配合关系-${suffix}`,
    };
    const customerIds = [
      id("visibility-owner-only"),
      id("visibility-operator-related"),
      id("visibility-expert-related"),
    ];
    await db.leadCustomer.createMany({
      data: [
        {
          id: customerIds[0],
          phone: `971${suffix.replaceAll("-", "").slice(0, 9)}`,
          customerName: names.ownerOnly,
          batchId: batch.id,
          ownerId: ids.berlinReception,
          attributionOwnerId: ids.berlinReception,
          groupOperatorOwnerId: ids.berlinOperatorB,
          groupStatus: "JOINED",
          joinedOn: "2026-09-01",
        },
        {
          id: customerIds[1],
          phone: `972${suffix.replaceAll("-", "").slice(0, 9)}`,
          customerName: names.operatorRelated,
          batchId: batch.id,
          ownerId: ids.berlinReception,
          attributionOwnerId: ids.berlinReception,
          groupOperatorOwnerId: ids.berlinOperatorA,
          groupStatus: "JOINED",
          joinedOn: "2026-09-01",
        },
        {
          id: customerIds[2],
          phone: `973${suffix.replaceAll("-", "").slice(0, 9)}`,
          customerName: names.expertRelated,
          batchId: batch.id,
          ownerId: ids.berlinReception,
          attributionOwnerId: ids.berlinReception,
          groupOperatorOwnerId: ids.berlinOperatorB,
          expertOwnerId: ids.berlinExpert,
          groupStatus: "JOINED",
          joinedOn: "2026-09-01",
          expertIntroducedOn: "2026-09-02",
        },
      ],
    });
    const readByName = async (userId: string, customerName: string) => {
      await signIn(userId);
      const response = await getLeadCustomerReporting(
        new Request(
          `http://localhost/api/lead/customer-reporting?stage=group&q=${encodeURIComponent(customerName)}`,
        ),
      );
      expect(response.status).toBe(200);
      return response.json();
    };

    try {
      const operatorOwn = await readByName(
        ids.berlinOperatorA,
        names.operatorRelated,
      );
      expect(operatorOwn.customers).toHaveLength(1);

      const operatorUnrelated = await readByName(
        ids.berlinOperatorA,
        names.ownerOnly,
      );
      expect(operatorUnrelated.customers).toHaveLength(0);
      expect(operatorUnrelated.total).toBe(0);
      expect(operatorUnrelated.summary.customerCount).toBe(0);

      await db.user.update({
        where: { id: ids.berlinOperatorA },
        data: { canViewAllGroupCustomers: true },
      });
      const operatorReadOnly = await readByName(
        ids.berlinOperatorA,
        names.ownerOnly,
      );
      expect(operatorReadOnly.customers).toHaveLength(1);
      const forbiddenEdit = await patchSharedCustomer(
        new Request(
          `http://localhost/api/lead/customer-reporting/${customerIds[0]}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "setDeviceCode", code: "不应修改" }),
          },
        ),
        { params: Promise.resolve({ leadId: customerIds[0] }) },
      );
      expect(forbiddenEdit.status).toBe(403);
      await db.user.update({
        where: { id: ids.berlinOperatorA },
        data: { canViewAllGroupCustomers: false },
      });

      expect(operatorUnrelated.memberOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ids.berlinOperatorB }),
          expect.objectContaining({ id: ids.berlinExpert }),
        ]),
      );
      expect(operatorUnrelated.receptionOptions).toEqual([
        expect.objectContaining({ id: ids.berlinReception }),
      ]);
      expect(operatorUnrelated.operatorOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ids.berlinOperatorA }),
          expect.objectContaining({ id: ids.berlinOperatorB }),
          expect.objectContaining({ id: ids.lead }),
        ]),
      );
      expect(operatorUnrelated.operatorOptions).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ids.berlinReception }),
          expect.objectContaining({ id: ids.berlinExpert }),
        ]),
      );
      expect(operatorUnrelated.expertOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: ids.berlinExpert }),
          expect.objectContaining({ id: ids.lead }),
        ]),
      );

      const expertOwn = await readByName(
        ids.berlinExpert,
        names.expertRelated,
      );
      expect(expertOwn.customers).toHaveLength(1);
      const expertUnrelated = await readByName(
        ids.berlinExpert,
        names.operatorRelated,
      );
      expect(expertUnrelated.customers).toHaveLength(0);

      const receptionOwn = await readByName(
        ids.berlinReception,
        names.ownerOnly,
      );
      expect(receptionOwn.customers).toHaveLength(1);

      const leadSeesAll = await readByName(ids.lead, names.ownerOnly);
      expect(leadSeesAll.customers).toHaveLength(1);
    } finally {
      await db.leadCustomer.deleteMany({
        where: { id: { in: customerIds } },
      });
    }
  });

  it("共享表的专家列需要专家权限并记录审计", async () => {
    const leadId = id("customer-group");
    const patch = (body: Record<string, unknown>) =>
      patchSharedCustomer(
        new Request(`http://localhost/api/lead/customer-reporting/${leadId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ leadId }) },
      );
    const correctAttribution = () =>
      correctSharedCustomerAttribution(
        new Request(
          `http://localhost/api/lead/customer-reporting/${leadId}/attribution-correction`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              attributionOwnerId: ids.berlinReception,
              channelId: id("berlin-channel"),
              sourceDate: "2026-07-02",
              reason: "历史接粉日期录错",
            }),
          },
        ),
        { params: Promise.resolve({ leadId }) },
      );

    await signIn(ids.berlinExpert);
    expect(
      (
        await patch({
          action: "assignGroupOperator",
          userId: ids.berlinOperatorA,
        })
      ).status,
    ).toBe(403);
    expect(
      (await patch({ action: "setDeviceCode", code: "B-手填-08" })).status,
    ).toBe(403);
    expect(
      (await patch({ action: "setSourceDate", occurredOn: "2026-07-02" }))
        .status,
    ).toBe(403);
    expect(
      (await patch({ action: "setJoinedOn", occurredOn: "2026-07-04" })).status,
    ).toBe(403);

    await signIn(ids.lead);
    expect((await correctAttribution()).status).toBe(200);
    expect(
      (
        await patch({
          action: "assignGroupOperator",
          userId: ids.berlinOperatorA,
        })
      ).status,
    ).toBe(200);

    await signIn(ids.berlinOperatorA);
    expect(
      (await patch({ action: "setDeviceCode", code: "B-手填-08" })).status,
    ).toBe(200);
    expect(
      (await patch({ action: "setJoinedOn", occurredOn: "2026-07-04" })).status,
    ).toBe(400);
    expect(
      (await patch({ action: "setJoinedOn", occurredOn: "2026-09-01" })).status,
    ).toBe(200);
    expect(
      (
        await patch({
          action: "assignExpert",
          userId: ids.berlinExpert,
          occurredOn: "2026-09-02",
        })
      )
        .status,
    ).toBe(200);

    await signIn(ids.berlinOperatorA);
    expect(
      (await patch({ action: "setRegistration", occurredOn: "2026-07-09" }))
        .status,
    ).toBe(403);
    await signIn(ids.berlinExpert);
    expect(
      (await patch({ action: "setRegistration", occurredOn: "2026-09-01" }))
        .status,
    ).toBe(400);
    expect(
      (await patch({ action: "setRegistration", occurredOn: "2026-09-02" }))
        .status,
    ).toBe(200);
    await signIn(ids.berlinOperatorA);
    expect(
      (await patch({ action: "setOwner", userId: ids.berlinReception })).status,
    ).toBe(403);

    expect(
      await db.leadCustomer.findUniqueOrThrow({
        where: { id: leadId },
        select: {
          joinedOn: true,
          groupOperatorOwnerId: true,
          expertOwnerId: true,
          registeredOn: true,
          device: { select: { code: true } },
          batch: { select: { sourceDate: true } },
        },
      }),
    ).toEqual({
      joinedOn: "2026-09-01",
      groupOperatorOwnerId: ids.berlinOperatorA,
      expertOwnerId: ids.berlinExpert,
      registeredOn: "2026-09-02",
      device: { code: "B-手填-08" },
      batch: { sourceDate: "2026-07-02" },
    });
    expect(
      await db.auditLog.count({
        where: { entityId: leadId, action: { startsWith: "SHARED_CUSTOMER_" } },
      }),
    ).toBe(5);

    expect(
      (
        await patch({
          action: "setLeave",
          leaveType: "NORMAL",
          occurredOn: "2026-09-02",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await patch({
          action: "setLeave",
          leaveType: "ABNORMAL",
          occurredOn: "2026-09-02",
        })
      ).status,
    ).toBe(200);
    await expect(
      db.leadCustomer.findUniqueOrThrow({ where: { id: leadId } }),
    ).resolves.toMatchObject({
      groupStatus: "LEFT",
      leftWithOrder: false,
      leftOn: "2026-09-02",
    });
    expect(
      (await patch({ action: "setLeave", leaveType: "NONE" })).status,
    ).toBe(200);
    await expect(
      db.leadCustomer.findUniqueOrThrow({ where: { id: leadId } }),
    ).resolves.toMatchObject({
      groupStatus: "JOINED",
      leftWithOrder: null,
      leftOn: null,
    });
    await expect(
      db.leadActivity.findFirst({
        where: { leadId, note: { contains: "撤销退群记录" } },
      }),
    ).resolves.not.toBeNull();
  });
});
