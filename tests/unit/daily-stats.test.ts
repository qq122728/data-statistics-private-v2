import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { GET, PATCH, POST } from "../../src/app/api/daily-stats/route";
import { GET as GET_REVIEW, PATCH as PATCH_REVIEW, POST as FORWARD_TO_RESOURCE } from "../../src/app/api/lead/daily-stats/route";
import { GET as GET_RESOURCE_REVIEW, PATCH as RESOURCE_REVIEW } from "../../src/app/api/resource/daily-stats/route";
import { GET as GET_RESOURCE_REPORTING } from "../../src/app/api/resource/reporting/route";
import { GET as GET_PERSONAL_PERFORMANCE } from "../../src/app/api/personal-performance/route";
import { db } from "../../src/lib/db";

const prefix = "daily-stat-test-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await db.dailyStatEntry.updateMany({
    where: { groupId: { startsWith: prefix } },
    data: { currentRevisionId: null, approvedRevisionId: null },
  });
  await db.dailyStatRevision.deleteMany({ where: { entry: { groupId: { startsWith: prefix } } } });
  await db.dailyStatEntry.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

async function fixture() {
  const suffix = randomUUID();
  const departmentId = `${prefix}department-${suffix}`;
  const groupId = `${prefix}group-${suffix}`;
  const channelId = `${prefix}channel-${suffix}`;
  await db.department.create({ data: { id: departmentId, name: `${prefix}部门-${suffix}`, timezone: "UTC" } });
  await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, departmentId, timezone: "UTC" } });
  const [lead, reception, operator, expert, resource] = await Promise.all([
    db.user.create({ data: { id: `${prefix}lead-${suffix}`, username: `${prefix}lead-${suffix}`, name: "组长", role: "LEAD", duty: "LEAD", groupId } }),
    db.user.create({ data: { id: `${prefix}reception-${suffix}`, username: `${prefix}reception-${suffix}`, name: "东来", role: "RECEPTION", groupId } }),
    db.user.create({ data: { id: `${prefix}operator-${suffix}`, username: `${prefix}operator-${suffix}`, name: "一峰", role: "GROUP_OPERATOR", groupId } }),
    db.user.create({ data: { id: `${prefix}expert-${suffix}`, username: `${prefix}expert-${suffix}`, name: "名将", role: "EXPERT", groupId } }),
    db.user.create({ data: { id: `${prefix}resource-${suffix}`, username: `${prefix}resource-${suffix}`, name: "资源审核", role: "RESOURCE_MANAGER" } }),
  ]);
  await db.channel.create({ data: { id: channelId, groupId, name: "嘉豪", normalizedName: `${prefix}嘉豪-${suffix}`, channelType: "ADS" } });
  await db.resourceChannelAccess.create({ data: { userId: resource.id, channelId } });
  return { groupId, channelId, lead, reception, operator, expert, resource: { ...resource, resourceChannelAccess: [{ channelId }] } };
}

function signInAs(user: auth.SessionUser) {
  vi.restoreAllMocks();
  vi.spyOn(auth, "requireUser").mockResolvedValue(user);
}

function request(method: string, body: unknown) {
  return new Request("http://localhost/api/daily-stats", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const emptyValues = {
  dispatchCount: 0,
  duplicateCount: 0,
  lowAmountCount: 0,
  noWsCount: 0,
  replyCount: 0,
  joinCount: 0,
  operatorReceivedCount: 0,
  normalLeaveCount: 0,
  abnormalLeaveCount: 0,
  currentInGroupCount: 0,
  expertIntroCount: 0,
  expertReceivedCount: 0,
  expertContactedCount: 0,
  registrationCount: 0,
  orderCount: 0,
  cryptoInitialDepositCents: 0,
  bankInitialDepositCents: 0,
  cryptoRechargeCents: 0,
  bankRechargeCents: 0,
  withdrawalCents: 0,
};

describe.sequential("独立每日数据填写、修改与审核", () => {
  it("computes effective fans, preserves the approved revision during correction, then promotes the new version", async () => {
    const data = await fixture();
    const emptyGroupId = `${prefix}empty-group-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: emptyGroupId, name: "同渠道空白小组", departmentId: (await db.teamGroup.findUniqueOrThrow({ where: { id: data.groupId } })).departmentId, timezone: "UTC" } });
    await db.channel.create({ data: { id: data.channelId, groupId: emptyGroupId, name: "嘉豪", normalizedName: `同渠道空白-${randomUUID()}`, channelType: "ADS" } });
    signInAs(data.reception);
    const created = await POST(request("POST", {
      businessDate: "2026-08-29",
      position: "RECEPTION",
      channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 100, lowAmountCount: 10, noWsCount: 5, duplicateCount: 2, replyCount: 30, joinCount: 15 },
    }));
    expect(created.status).toBe(201);
    const createdEntry = (await created.json() as { entry: { id: string; currentRevision: { effectiveCount: number } } }).entry;
    expect(createdEntry.currentRevision.effectiveCount).toBe(85);

    const submitted = await PATCH(request("PATCH", { entryId: createdEntry.id, action: "SUBMIT" }));
    expect(submitted.status).toBe(200);
    await db.user.updateMany({ where: { id: { in: [data.operator.id, data.expert.id] } }, data: { active: false } });
    signInAs(data.lead);
    const inbox = await GET_REVIEW(new Request("http://localhost/api/lead/daily-stats"));
    expect((await inbox.json() as { entries: unknown[] }).entries).toHaveLength(1);
    expect((await FORWARD_TO_RESOURCE(request("POST", { businessDate: "2026-08-29" }))).status).toBe(200);
    signInAs(data.resource);
    expect((await GET_RESOURCE_REVIEW()).status).toBe(200);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId: createdEntry.id, action: "APPROVE" }))).status).toBe(200);
    const resourceReport = await GET_RESOURCE_REPORTING(new Request("http://localhost/api/resource/reporting?range=custom&sourceDateFrom=2026-08-29&sourceDateTo=2026-08-29"));
    expect(resourceReport.status).toBe(200);
    const resourceRows = (await resourceReport.json()).rows as Array<{ group: { id: string }; totals: { added: number; effective: number; lowAmount: number; noWs: number; replied: number } }>;
    expect(resourceRows.find((row) => row.group.id === data.groupId)?.totals).toMatchObject({
      added: 100, effective: 85, lowAmount: 10, noWs: 5, replied: 30,
    });
    expect(resourceRows.find((row) => row.group.id === emptyGroupId)?.totals).toMatchObject({
      added: 0, effective: 0, lowAmount: 0, noWs: 0, replied: 0,
    });

    signInAs(data.reception);
    const corrected = await POST(request("POST", {
      entryId: createdEntry.id,
      businessDate: "2026-08-29",
      position: "RECEPTION",
      channelId: data.channelId,
      changeReason: "回复数少填一人",
      values: { ...emptyValues, dispatchCount: 100, lowAmountCount: 10, noWsCount: 5, duplicateCount: 2, replyCount: 31, joinCount: 15 },
    }));
    expect(corrected.status).toBe(201);
    const duringCorrection = await db.dailyStatEntry.findUniqueOrThrow({
      where: { id: createdEntry.id },
      include: { currentRevision: true, approvedRevision: true },
    });
    expect(duringCorrection.currentRevision?.replyCount).toBe(31);
    expect(duringCorrection.approvedRevision?.replyCount).toBe(30);

    await PATCH(request("PATCH", { entryId: createdEntry.id, action: "SUBMIT" }));
    signInAs(data.lead);
    await FORWARD_TO_RESOURCE(request("POST", { businessDate: "2026-08-29" }));
    signInAs(data.resource);
    await RESOURCE_REVIEW(request("PATCH", { entryId: createdEntry.id, action: "APPROVE" }));
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id: createdEntry.id }, include: { approvedRevision: true } }))
      .resolves.toMatchObject({ status: "APPROVED", approvedRevision: { replyCount: 31 } });
  });

  it("carries a reviewer return reason into the next revision and marks it as a correction", async () => {
    const data = await fixture();
    signInAs(data.reception);
    const created = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 2 },
    }));
    const entryId = (await created.json() as { entry: { id: string } }).entry.id;
    await PATCH(request("PATCH", { entryId, action: "SUBMIT" }));
    await db.user.updateMany({ where: { id: { in: [data.operator.id, data.expert.id] } }, data: { active: false } });

    signInAs(data.lead);
    expect((await PATCH_REVIEW(request("PATCH", { entryId, action: "RETURN", reason: "回复数量需要复核" }))).status).toBe(200);

    signInAs(data.reception);
    expect((await POST(request("POST", {
      entryId, businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 3 },
    }))).status).toBe(201);
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id: entryId }, include: { currentRevision: true } }))
      .resolves.toMatchObject({ currentRevision: { version: 2, changeReason: "回复数量需要复核", replyCount: 3 } });
  });

  it("requires source reception for operator data and both source roles for expert data", async () => {
    const data = await fixture();
    signInAs(data.reception);
    const receptionRow = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 20, replyCount: 15, joinCount: 12 },
    }));
    const receptionEntryId = (await receptionRow.json() as { entry: { id: string } }).entry.id;

    signInAs(data.operator);
    const missingReception = await POST(request("POST", {
      businessDate: "2026-08-29", position: "GROUP_OPERATOR", channelId: data.channelId,
      values: { ...emptyValues, operatorReceivedCount: 12, currentInGroupCount: 23, expertIntroCount: 5 },
    }));
    expect(missingReception.status).toBe(400);

    const operatorRow = await POST(request("POST", {
      businessDate: "2026-08-29", position: "GROUP_OPERATOR", channelId: data.channelId,
      sourceReceptionId: data.reception.id,
      values: { ...emptyValues, operatorReceivedCount: 12, normalLeaveCount: 2, abnormalLeaveCount: 1, currentInGroupCount: 23, expertIntroCount: 5 },
    }));
    expect(operatorRow.status).toBe(201);
    const operatorEntryId = (await operatorRow.json() as { entry: { id: string } }).entry.id;

    signInAs(data.expert);
    const expertRow = await POST(request("POST", {
      businessDate: "2026-08-29", position: "EXPERT", channelId: data.channelId,
      sourceReceptionId: data.reception.id, sourceGroupOperatorId: data.operator.id,
      values: { ...emptyValues, expertReceivedCount: 5, expertContactedCount: 4, registrationCount: 2, orderCount: 1, cryptoInitialDepositCents: 114800 },
    }));
    expect(expertRow.status).toBe(201);
    const expertEntryId = (await expertRow.json() as { entry: { id: string } }).entry.id;
    await expect(db.dailyStatEntry.findFirstOrThrow({ where: { ownerId: data.expert.id }, include: { currentRevision: true } }))
      .resolves.toMatchObject({
        sourceReceptionId: data.reception.id,
        sourceGroupOperatorId: data.operator.id,
        currentRevision: { expertReceivedCount: 5, cryptoInitialDepositCents: 114800 },
      });

    for (const [owner, entryId] of [[data.reception, receptionEntryId], [data.operator, operatorEntryId], [data.expert, expertEntryId]] as const) {
      signInAs(owner);
      expect((await PATCH(request("PATCH", { entryId, action: "SUBMIT" }))).status).toBe(200);
    }
    signInAs(data.lead);
    expect((await FORWARD_TO_RESOURCE(request("POST", { businessDate: "2026-08-29" }))).status).toBe(200);
    signInAs(data.resource);
    for (const entryId of [receptionEntryId, operatorEntryId, expertEntryId]) {
      expect((await RESOURCE_REVIEW(request("PATCH", { entryId, action: "APPROVE" }))).status).toBe(200);
    }

    signInAs(data.reception);
    const receptionPerformance = await GET_PERSONAL_PERFORMANCE(new Request("http://localhost/api/personal-performance?role=RECEPTION&range=month"));
    await expect(receptionPerformance.json()).resolves.toMatchObject({
      totals: { added: 20, joined: 12, introduced: 0, registered: 0, orders: 0 },
      funnel: {
        summary: { added: 20, joined: 12, leftNormal: 2, leftAbnormal: 1, pushed: 5, registered: 2, ordered: 1, depositCents: 114800 },
        currentInGroup: 23,
        channels: [expect.objectContaining({ name: "嘉豪", row: expect.objectContaining({ pushed: 5, ordered: 1 }) })],
      },
    });

    signInAs(data.operator);
    const operatorPerformance = await GET_PERSONAL_PERFORMANCE(new Request("http://localhost/api/personal-performance?role=GROUP_OPERATOR&range=month"));
    await expect(operatorPerformance.json()).resolves.toMatchObject({
      totals: { joined: 12, introduced: 5, registered: 0, orders: 0 },
      funnel: { summary: { joined: 12, pushed: 5, registered: 2, ordered: 1, depositCents: 114800 }, currentInGroup: 23 },
    });

    signInAs(data.expert);
    const expertPerformance = await GET_PERSONAL_PERFORMANCE(new Request("http://localhost/api/personal-performance?role=EXPERT&range=month"));
    await expect(expertPerformance.json()).resolves.toMatchObject({
      totals: { registered: 2, orders: 1, initialDepositCents: 114800 },
      funnel: { summary: { pushed: 5, registered: 2, ordered: 1, depositCents: 114800 }, currentInGroup: 0 },
    });
  });

  it("lets an employee withdraw a pending row before editing", async () => {
    const data = await fixture();
    signInAs(data.reception);
    const created = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 3 },
    }));
    const id = (await created.json() as { entry: { id: string } }).entry.id;
    await PATCH(request("PATCH", { entryId: id, action: "SUBMIT" }));
    const blocked = await POST(request("POST", {
      entryId: id, businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 4 },
    }));
    expect(blocked.status).toBe(409);
    const withdrawn = await PATCH(request("PATCH", { entryId: id, action: "WITHDRAW" }));
    expect(withdrawn.status).toBe(200);
    const edited = await POST(request("POST", {
      entryId: id, businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 4 },
    }));
    expect(edited.status).toBe(201);
  });

  it("lists the actor's own rows and role-aware form options", async () => {
    const data = await fixture();
    signInAs(data.reception);
    await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10 },
    }));
    const response = await GET(new Request("http://localhost/api/daily-stats"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      positions: ["RECEPTION"],
      channels: [expect.objectContaining({ id: data.channelId })],
      entries: [expect.objectContaining({ ownerId: data.reception.id })],
    });
  });
});
