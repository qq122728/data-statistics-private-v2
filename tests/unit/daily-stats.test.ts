import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { GET, POST } from "../../src/app/api/daily-stats/route";
import { GET as GET_RESOURCE_REVIEW, PATCH as RESOURCE_REVIEW } from "../../src/app/api/resource/daily-stats/route";
import { GET as GET_RESOURCE_REPORTING } from "../../src/app/api/resource/reporting/route";
import { GET as GET_PERSONAL_PERFORMANCE } from "../../src/app/api/personal-performance/route";
import { db } from "../../src/lib/db";
import { incrementCustomerEventDailyStat } from "../../src/lib/daily-stats";

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
  await db.userPosition.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

async function fixture(groupType: "HACKER" | "LAWYER" = "HACKER") {
  const suffix = randomUUID();
  const departmentId = `${prefix}department-${suffix}`;
  const groupId = `${prefix}group-${suffix}`;
  const channelId = `${prefix}channel-${suffix}`;
  await db.department.create({ data: { id: departmentId, name: `${prefix}部门-${suffix}`, timezone: "UTC" } });
  await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, groupType, departmentId, timezone: "UTC" } });
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
  it("律师组不会套用黑客组的号码漏斗", async () => {
    const data = await fixture("LAWYER");
    await db.$transaction((tx) => incrementCustomerEventDailyStat(tx, {
      ownerId: data.operator.id,
      groupId: data.groupId,
      channelId: data.channelId,
      businessDate: "2026-09-02",
      position: "GROUP_OPERATOR",
      sourceReceptionId: data.reception.id,
      reason: "律师组客户进群",
      increment: { operatorReceivedCount: 1 },
    }));

    await expect(db.dailyStatEntry.count({ where: { groupId: data.groupId } })).resolves.toBe(0);
  });

  it("当天添加为 0 时，老客户进群、注册和开单仍按发生日自动统计", async () => {
    const data = await fixture();
    await db.$transaction(async (tx) => {
      await incrementCustomerEventDailyStat(tx, {
        ownerId: data.operator.id, groupId: data.groupId, channelId: data.channelId,
        businessDate: "2026-09-02", position: "GROUP_OPERATOR", sourceReceptionId: data.reception.id,
        reason: "老客户今天进群并推专家", increment: { operatorReceivedCount: 1, expertIntroCount: 1 }, currentInGroupSnapshot: 1,
      });
      await incrementCustomerEventDailyStat(tx, {
        ownerId: data.expert.id, groupId: data.groupId, channelId: data.channelId,
        businessDate: "2026-09-02", position: "EXPERT", sourceReceptionId: data.reception.id, sourceGroupOperatorId: data.operator.id,
        reason: "老客户今天注册", increment: { registrationCount: 1 },
      });
      await incrementCustomerEventDailyStat(tx, {
        ownerId: data.expert.id, groupId: data.groupId, channelId: data.channelId,
        businessDate: "2026-09-02", position: "EXPERT", sourceReceptionId: data.reception.id, sourceGroupOperatorId: data.operator.id,
        reason: "老客户今天开单", increment: { orderCount: 1 },
      });
    });

    const entries = await db.dailyStatEntry.findMany({
      where: { groupId: data.groupId, businessDate: "2026-09-02" },
      include: { currentRevision: true },
    });
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.position === "GROUP_OPERATOR")?.currentRevision).toMatchObject({
      dispatchCount: 0, operatorReceivedCount: 1, currentInGroupCount: 1, expertIntroCount: 1,
    });
    expect(entries.find((entry) => entry.position === "EXPERT")?.currentRevision).toMatchObject({
      dispatchCount: 0, registrationCount: 1, orderCount: 1,
    });
  });

  it("律师组保存独立指标，并按接粉数校验回复和添加数", async () => {
    const data = await fixture("LAWYER");
    signInAs(data.reception);
    const created = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: {
        ...emptyValues,
        dispatchCount: 10,
        replyCount: 6,
        lowAmountCount: 2,
        lawyerRealCaseCount: 4,
        lawyerAddedCount: 5,
        lawyerExpertAddedCount: 3,
        customerServicePushCount: 7,
        registrationCount: 2,
        orderCount: 1,
        cryptoInitialDepositCents: 12_000,
        bankInitialDepositCents: 8_000,
        withdrawalCents: 1_000,
      },
    }));
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ entry: { currentRevision: {
      dispatchCount: 10, replyCount: 6, lowAmountCount: 2, lawyerRealCaseCount: 4,
      lawyerAddedCount: 5, lawyerExpertAddedCount: 3, customerServicePushCount: 7,
      registrationCount: 2, orderCount: 1,
    } } });

    const invalid = await POST(request("POST", {
      businessDate: "2026-08-28", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, lawyerAddedCount: 11 },
    }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "添加律师数量不能超过接粉数量" });
  });

  it("lets the original employee correct a migrated row from a former position and converts its identity", async () => {
    const data = await fixture();
    const entryId = `${prefix}migrated-entry-${randomUUID()}`;
    const revisionId = `${prefix}migrated-revision-${randomUUID()}`;
    await db.dailyStatEntry.create({ data: {
      id: entryId,
      identityKey: `legacy-metric-v1:${entryId}`,
      ownerId: data.reception.id,
      groupId: data.groupId,
      channelId: data.channelId,
      businessDate: "2026-08-29",
      timezone: "UTC",
      position: "RECEPTION",
      status: "APPROVED",
    } });
    await db.dailyStatRevision.create({ data: {
      id: revisionId, entryId, version: 1, createdById: data.reception.id,
      changeReason: "迁移记录", dispatchCount: 20, effectiveCount: 20, replyCount: 5,
    } });
    await db.dailyStatEntry.update({ where: { id: entryId }, data: { currentRevisionId: revisionId, approvedRevisionId: revisionId } });

    await db.user.update({ where: { id: data.reception.id }, data: { role: "GROUP_OPERATOR" } });
    signInAs({ ...data.reception, role: "GROUP_OPERATOR" });
    const response = await POST(request("POST", {
      entryId,
      businessDate: "2026-08-29",
      position: "RECEPTION",
      channelId: data.channelId,
      changeReason: "旧数据回复数填少了",
      values: { ...emptyValues, dispatchCount: 20, replyCount: 6 },
    }));
    expect(response.status).toBe(201);
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id: entryId }, include: { currentRevision: true, approvedRevision: true } }))
      .resolves.toMatchObject({
        identityKey: expect.not.stringContaining("legacy-metric-v1:"),
        status: "RESOURCE_PENDING",
        currentRevision: { version: 2, replyCount: 6 },
        approvedRevision: { version: 1, replyCount: 5 },
      });

    const unauthorizedNewRow = await POST(request("POST", {
      businessDate: "2026-08-28",
      position: "RECEPTION",
      channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 2 },
    }));
    expect(unauthorizedNewRow.status).toBe(201);
  });

  it("lets a resource account confirm only explicitly assigned channel ids", async () => {
    const data = await fixture();
    const departmentId = (await db.teamGroup.findUniqueOrThrow({ where: { id: data.groupId } })).departmentId;
    const secondGroupId = `${prefix}same-type-group-${randomUUID()}`;
    const adsChannelId = `${prefix}second-ads-${randomUUID()}`;
    const smsChannelId = `${prefix}unrelated-sms-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: secondGroupId, name: "同类型第二小组", departmentId, timezone: "UTC" } });
    const [secondReception, smsReception] = await Promise.all([
      db.user.create({ data: { id: `${prefix}second-reception-${randomUUID()}`, username: `${prefix}second-reception-${randomUUID()}`, name: "第二接粉", role: "RECEPTION", groupId: secondGroupId } }),
      db.user.create({ data: { id: `${prefix}sms-reception-${randomUUID()}`, username: `${prefix}sms-reception-${randomUUID()}`, name: "短信接粉", role: "RECEPTION", groupId: secondGroupId } }),
    ]);
    await Promise.all([
      db.channel.create({ data: { id: adsChannelId, groupId: secondGroupId, name: "第二投流", normalizedName: adsChannelId, channelType: "ADS" } }),
      db.channel.create({ data: { id: smsChannelId, groupId: secondGroupId, name: "短信渠道", normalizedName: smsChannelId, channelType: "SMS" } }),
    ]);

    signInAs(secondReception);
    const adsEntry = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: adsChannelId,
      values: { ...emptyValues, dispatchCount: 9, replyCount: 2 },
    }));
    signInAs(smsReception);
    const smsEntry = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: smsChannelId,
      values: { ...emptyValues, dispatchCount: 7, replyCount: 1 },
    }));
    const adsEntryId = (await adsEntry.json() as { entry: { id: string } }).entry.id;
    const smsEntryId = (await smsEntry.json() as { entry: { id: string } }).entry.id;

    signInAs(data.resource);
    const report = await GET_RESOURCE_REPORTING(new Request("http://localhost/api/resource/reporting?range=custom&sourceDateFrom=2026-08-29&sourceDateTo=2026-08-29"));
    expect(report.status).toBe(200);
    const reportBody = await report.json() as { channels: Array<{ id: string }>; rows: Array<{ channel: { id: string } }> };
    expect(reportBody.channels.map((channel) => channel.id)).toEqual([data.channelId]);
    expect(reportBody.rows.every((row) => row.channel.id === data.channelId)).toBe(true);
    expect(reportBody.channels.map((channel) => channel.id)).not.toContain(adsChannelId);
    expect(reportBody.channels.map((channel) => channel.id)).not.toContain(smsChannelId);
    const inbox = await GET_RESOURCE_REVIEW();
    expect((await inbox.json() as { entries: Array<{ id: string }> }).entries.map((entry) => entry.id)).not.toContain(adsEntryId);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId: adsEntryId, action: "APPROVE" }))).status).toBe(404);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId: smsEntryId, action: "APPROVE" }))).status).toBe(404);
  });

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
    expect(createdEntry.currentRevision.effectiveCount).toBe(83);

    signInAs(data.resource);
    const firstInbox = await GET_RESOURCE_REVIEW();
    expect(firstInbox.status).toBe(200);
    expect((await firstInbox.json() as { entries: Array<{ id: string }> }).entries).toEqual([
      expect.objectContaining({ id: createdEntry.id }),
    ]);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId: createdEntry.id, action: "APPROVE" }))).status).toBe(200);
    const resourceReport = await GET_RESOURCE_REPORTING(new Request("http://localhost/api/resource/reporting?range=custom&sourceDateFrom=2026-08-29&sourceDateTo=2026-08-29"));
    expect(resourceReport.status).toBe(200);
    const resourceBody = await resourceReport.json();
    const resourceRows = resourceBody.rows as Array<{ group: { id: string }; totals: { added: number; effective: number; lowAmount: number; noWs: number; replied: number } }>;
    expect(resourceRows.find((row) => row.group.id === data.groupId)?.totals).toMatchObject({
      added: 100, effective: 83, lowAmount: 10, noWs: 5, replied: 30,
    });
    expect(resourceRows.find((row) => row.group.id === emptyGroupId)?.totals).toMatchObject({
      added: 0, effective: 0, lowAmount: 0, noWs: 0, replied: 0,
    });
    expect(resourceBody.days).toEqual([
      expect.objectContaining({
        date: "2026-08-29",
        rows: [expect.objectContaining({ group: expect.objectContaining({ id: data.groupId, name: expect.any(String), departmentName: expect.any(String), groupType: "HACKER" }), totals: expect.objectContaining({ added: 100, effective: 83, replied: 30 }) })],
      }),
    ]);

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

    signInAs(data.resource);
    await RESOURCE_REVIEW(request("PATCH", { entryId: createdEntry.id, action: "APPROVE" }));
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id: createdEntry.id }, include: { approvedRevision: true } }))
      .resolves.toMatchObject({ status: "APPROVED", approvedRevision: { replyCount: 31 } });
  });

  it("lets reception privately correct a resource-pending row before resource confirmation", async () => {
    const data = await fixture();
    signInAs(data.reception);
    const created = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 2 },
    }));
    const entryId = (await created.json() as { entry: { id: string } }).entry.id;
    signInAs(data.reception);
    expect((await POST(request("POST", {
      entryId, businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 3 },
    }))).status).toBe(201);
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id: entryId }, include: { currentRevision: true } }))
      .resolves.toMatchObject({ status: "RESOURCE_PENDING", currentRevision: { version: 2, replyCount: 3 } });

    signInAs(data.resource);
    const inbox = await GET_RESOURCE_REVIEW();
    await expect(inbox.json()).resolves.toMatchObject({
      entries: [expect.objectContaining({ id: entryId, currentRevision: expect.objectContaining({ version: 2, replyCount: 3 }) })],
    });
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId, action: "RETURN", reason: "不走系统退回" }))).status).toBe(400);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId, action: "APPROVE" }))).status).toBe(200);
  });

  it("rejects impossible same-day reception counts but allows registrations and orders from earlier customers", async () => {
    const data = await fixture();
    signInAs(data.reception);
    const tooManyReplies = await POST(request("POST", {
      businessDate: "2026-08-20", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, duplicateCount: 2, replyCount: 9 },
    }));
    expect(tooManyReplies.status).toBe(400);
    await expect(tooManyReplies.json()).resolves.toEqual({ error: "回复数量不能超过有效数据数量" });
    const tooManyJoins = await POST(request("POST", {
      businessDate: "2026-08-21", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, noWsCount: 3, joinCount: 8 },
    }));
    expect(tooManyJoins.status).toBe(400);
    await expect(tooManyJoins.json()).resolves.toEqual({ error: "进群数量不能超过有效数据数量" });

    const receptionCrossDay = await POST(request("POST", {
      businessDate: "2026-08-22", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, registrationCount: 3, orderCount: 2 },
    }));
    expect(receptionCrossDay.status).toBe(201);

    signInAs(data.expert);
    const registrationsFromEarlierCustomers = await POST(request("POST", {
      businessDate: "2026-08-23", position: "EXPERT", channelId: data.channelId, sourceReceptionId: data.reception.id, sourceGroupOperatorId: data.operator.id,
      values: { ...emptyValues, registrationCount: 4 },
    }));
    expect(registrationsFromEarlierCustomers.status).toBe(201);
    const ordersFromEarlierCustomers = await POST(request("POST", {
      businessDate: "2026-08-24", position: "EXPERT", channelId: data.channelId, sourceReceptionId: data.reception.id, sourceGroupOperatorId: data.operator.id,
      values: { ...emptyValues, orderCount: 3 },
    }));
    expect(ordersFromEarlierCustomers.status).toBe(201);
  });

  it("merges same-day member snapshot sources and carries each source latest value across dates", async () => {
    const data = await fixture();
    const secondReception = await db.user.create({ data: { id: `${prefix}second-source-${randomUUID()}`, username: `${prefix}second-source-${randomUUID()}`, name: "第二来源接粉", role: "RECEPTION", groupId: data.groupId } });
    signInAs(data.operator);
    for (const row of [
      { businessDate: "2026-08-20", sourceReceptionId: data.reception.id, currentInGroupCount: 10 },
      { businessDate: "2026-08-20", sourceReceptionId: secondReception.id, currentInGroupCount: 20 },
      { businessDate: "2026-08-21", sourceReceptionId: data.reception.id, currentInGroupCount: 12 },
    ]) {
      const response = await POST(request("POST", {
        businessDate: row.businessDate, position: "GROUP_OPERATOR", channelId: data.channelId, sourceReceptionId: row.sourceReceptionId,
        values: { ...emptyValues, currentInGroupCount: row.currentInGroupCount },
      }));
      expect(response.status).toBe(201);
    }
    signInAs(data.resource);
    const response = await GET_RESOURCE_REPORTING(new Request("http://localhost/api/resource/reporting?range=custom&sourceDateFrom=2026-08-20&sourceDateTo=2026-08-21"));
    expect(response.status).toBe(200);
    const payload = await response.json() as { memberRows: Array<{ date: string; member: { id: string }; totals: { inGroup: number } }> };
    expect(payload.memberRows.find((row) => row.date === "2026-08-20" && row.member.id === data.reception.id)?.totals.inGroup).toBe(10);
    expect(payload.memberRows.find((row) => row.date === "2026-08-20" && row.member.id === secondReception.id)?.totals.inGroup).toBe(20);
    expect(payload.memberRows.find((row) => row.date === "2026-08-21" && row.member.id === data.reception.id)?.totals.inGroup).toBe(12);
    expect(payload.memberRows.find((row) => row.date === "2026-08-21" && row.member.id === secondReception.id)?.totals.inGroup).toBe(20);
  });

  it("defaults legacy operator sources to the member while preserving explicit upstream attribution", async () => {
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
    expect(missingReception.status).toBe(201);
    const defaultedOperatorPayload = await missingReception.json() as { entry: { id: string; ownerId: string; sourceReceptionId: string } };
    expect(defaultedOperatorPayload).toMatchObject({
      entry: { ownerId: data.operator.id, sourceReceptionId: data.operator.id },
    });
    await db.dailyStatEntry.delete({ where: { id: defaultedOperatorPayload.entry.id } });

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

    signInAs(data.resource);
    const resourceInbox = await GET_RESOURCE_REVIEW();
    expect(resourceInbox.status).toBe(200);
    expect((await resourceInbox.json() as { entries: Array<{ id: string; position: string }> }).entries)
      .toEqual([expect.objectContaining({ id: receptionEntryId, position: "RECEPTION" })]);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId: receptionEntryId, action: "APPROVE" }))).status).toBe(200);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId: operatorEntryId, action: "APPROVE" }))).status).toBe(404);
    await expect(db.dailyStatEntry.findMany({
      where: { id: { in: [operatorEntryId, expertEntryId] } },
      select: { position: true, status: true, approvedRevisionId: true },
      orderBy: { position: "asc" },
    })).resolves.toEqual([
      expect.objectContaining({ position: "EXPERT", status: "APPROVED", approvedRevisionId: expect.any(String) }),
      expect.objectContaining({ position: "GROUP_OPERATOR", status: "APPROVED", approvedRevisionId: expect.any(String) }),
    ]);

    signInAs(data.reception);
    const unifiedLegacyContext = await GET(new Request("http://localhost/api/daily-stats?from=2026-08-29&to=2026-08-29"));
    await expect(unifiedLegacyContext.json()).resolves.toMatchObject({
      unifiedEntries: [expect.objectContaining({
        entryId: receptionEntryId,
        values: expect.objectContaining({ dispatchCount: 20, currentInGroupCount: 23, expertIntroCount: 5, registrationCount: 2, orderCount: 1, cryptoInitialDepositCents: 114800 }),
      })],
    });
    const receptionPerformance = await GET_PERSONAL_PERFORMANCE(new Request("http://localhost/api/personal-performance?role=RECEPTION&range=custom&sourceDateFrom=2026-08-29&sourceDateTo=2026-08-29"));
    await expect(receptionPerformance.json()).resolves.toMatchObject({
      totals: { added: 20, joined: 12, introduced: 0, registered: 0, orders: 0 },
      funnel: {
        summary: { added: 20, joined: 12, leftNormal: 2, leftAbnormal: 1, pushed: 5, registered: 2, ordered: 1, depositCents: 114800 },
        currentInGroup: 23,
        channels: [expect.objectContaining({ name: "嘉豪", row: expect.objectContaining({ pushed: 5, ordered: 1 }) })],
      },
    });

    signInAs(data.operator);
    const operatorPerformance = await GET_PERSONAL_PERFORMANCE(new Request("http://localhost/api/personal-performance?role=GROUP_OPERATOR&range=custom&sourceDateFrom=2026-08-29&sourceDateTo=2026-08-29"));
    await expect(operatorPerformance.json()).resolves.toMatchObject({
      totals: { joined: 12, introduced: 5, registered: 0, orders: 0 },
      funnel: { summary: { joined: 12, pushed: 5, registered: 2, ordered: 1, depositCents: 114800 }, currentInGroup: 23 },
    });

    signInAs(data.expert);
    const expertPerformance = await GET_PERSONAL_PERFORMANCE(new Request("http://localhost/api/personal-performance?role=EXPERT&range=custom&sourceDateFrom=2026-08-29&sourceDateTo=2026-08-29"));
    await expect(expertPerformance.json()).resolves.toMatchObject({
      totals: { registered: 2, orders: 1, initialDepositCents: 114800 },
      funnel: { summary: { pushed: 5, registered: 2, ordered: 1, depositCents: 114800 }, currentInGroup: 0 },
    });
  });

  it("replaces matching legacy position rows only after a complete unified member row is approved", async () => {
    const data = await fixture();
    signInAs(data.operator);
    const operatorRow = await POST(request("POST", {
      businessDate: "2026-08-28", position: "GROUP_OPERATOR", channelId: data.channelId,
      sourceReceptionId: data.reception.id,
      values: { ...emptyValues, operatorReceivedCount: 8, normalLeaveCount: 2, abnormalLeaveCount: 1, currentInGroupCount: 5, expertIntroCount: 4 },
    }));
    const operatorEntryId = (await operatorRow.json() as { entry: { id: string } }).entry.id;

    signInAs(data.expert);
    const expertRow = await POST(request("POST", {
      businessDate: "2026-08-28", position: "EXPERT", channelId: data.channelId,
      sourceReceptionId: data.reception.id, sourceGroupOperatorId: data.operator.id,
      values: { ...emptyValues, expertReceivedCount: 4, expertContactedCount: 3, registrationCount: 2, orderCount: 1, cryptoInitialDepositCents: 100_000, bankRechargeCents: 20_000, withdrawalCents: 5_000 },
    }));
    const expertEntryId = (await expertRow.json() as { entry: { id: string } }).entry.id;

    signInAs(data.reception);
    const unifiedRow = await POST(request("POST", {
      businessDate: "2026-08-28", channelId: data.channelId,
      values: {
        ...emptyValues,
        dispatchCount: 10, duplicateCount: 1, replyCount: 6, joinCount: 8,
        normalLeaveCount: 2, abnormalLeaveCount: 1, currentInGroupCount: 5,
        expertIntroCount: 4, expertContactedCount: 3, registrationCount: 2, orderCount: 1,
        cryptoInitialDepositCents: 100_000, bankRechargeCents: 20_000, withdrawalCents: 5_000,
      },
    }));
    expect(unifiedRow.status).toBe(201);
    const unifiedEntryId = (await unifiedRow.json() as { entry: { id: string } }).entry.id;

    const context = await GET(new Request("http://localhost/api/daily-stats?from=2026-08-28&to=2026-08-28"));
    await expect(context.json()).resolves.toMatchObject({
      unifiedEntries: [expect.objectContaining({
        entryId: unifiedEntryId,
        values: expect.objectContaining({ dispatchCount: 10, expertIntroCount: 4, orderCount: 1, bankRechargeCents: 20_000 }),
      })],
    });

    signInAs(data.resource);
    expect((await RESOURCE_REVIEW(request("PATCH", { entryId: unifiedEntryId, action: "APPROVE" }))).status).toBe(200);
    await expect(db.dailyStatEntry.findMany({
      where: { id: { in: [operatorEntryId, expertEntryId] } },
      select: { status: true, approvedRevisionId: true, reviewReason: true },
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "RETURNED", approvedRevisionId: null, reviewReason: expect.stringContaining(unifiedEntryId) }),
      expect.objectContaining({ status: "RETURNED", approvedRevisionId: null, reviewReason: expect.stringContaining(unifiedEntryId) }),
    ]));
  });

  it("lets reception edit a saved row freely while resource is still checking it", async () => {
    const data = await fixture();
    signInAs(data.reception);
    const created = await POST(request("POST", {
      businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 3 },
    }));
    const id = (await created.json() as { entry: { id: string } }).entry.id;
    const edited = await POST(request("POST", {
      entryId: id, businessDate: "2026-08-29", position: "RECEPTION", channelId: data.channelId,
      values: { ...emptyValues, dispatchCount: 10, replyCount: 4 },
    }));
    expect(edited.status).toBe(201);
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id }, include: { currentRevision: true } }))
      .resolves.toMatchObject({ status: "RESOURCE_PENDING", currentRevision: { version: 2, replyCount: 4 } });
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
      positions: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"],
      channels: [expect.objectContaining({ id: data.channelId })],
      entries: [expect.objectContaining({ ownerId: data.reception.id })],
      unifiedEntries: [expect.objectContaining({ entryId: expect.any(String), values: expect.objectContaining({ dispatchCount: 10 }) })],
    });
  });

  it("returns the operator's dated reception pairings for professional defaults", async () => {
    const data = await fixture();
    await db.groupOperatorReception.create({
      data: { groupOperatorId: data.operator.id, receptionistId: data.reception.id },
    });
    await db.groupOperatorReceptionHistory.create({
      data: {
        groupOperatorId: data.operator.id,
        receptionistId: data.reception.id,
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    signInAs(data.operator);

    const response = await GET(new Request("http://localhost/api/daily-stats"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      actorId: data.operator.id,
      sourceReceptionPairings: [{
        receptionistId: data.reception.id,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
      }],
    });
  });

  it("lets group-operator data choose self or another same-group member as the actual reception source", async () => {
    const data = await fixture();
    signInAs(data.operator);

    const created = await POST(request("POST", {
      businessDate: "2026-08-29",
      position: "GROUP_OPERATOR",
      channelId: data.channelId,
      sourceReceptionId: data.operator.id,
      values: { ...emptyValues, operatorReceivedCount: 3, currentInGroupCount: 3 },
    }));

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      entry: { ownerId: data.operator.id, sourceReceptionId: data.operator.id },
    });
  });

  it("lets a group lead fill personal expert daily data through the implicit expert role", async () => {
    const data = await fixture();
    signInAs(data.lead);

    const context = await GET(new Request("http://localhost/api/daily-stats"));
    expect(context.status).toBe(200);
    await expect(context.json()).resolves.toMatchObject({ positions: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] });

    const created = await POST(request("POST", {
      businessDate: "2026-08-29",
      position: "EXPERT",
      channelId: data.channelId,
      sourceReceptionId: data.reception.id,
      sourceGroupOperatorId: data.operator.id,
      values: {
        ...emptyValues,
        expertReceivedCount: 3,
        expertContactedCount: 2,
        registrationCount: 1,
        orderCount: 1,
        cryptoInitialDepositCents: 114800,
      },
    }));

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      entry: {
        ownerId: data.lead.id,
        position: "EXPERT",
        currentRevision: { expertReceivedCount: 3, orderCount: 1, cryptoInitialDepositCents: 114800 },
      },
    });
  });

  it("lets expert data select any current or historical member in the same group as its sources", async () => {
    const data = await fixture();
    const suffix = randomUUID();
    const historicalMember = await db.user.create({
      data: {
        id: `${prefix}historical-${suffix}`,
        username: `${prefix}historical-${suffix}`,
        name: "历史跨岗成员",
        role: "EXPERT",
        active: false,
        positionHistory: {
          create: {
            groupId: data.groupId,
            position: "EXPERT",
            effectiveFrom: "2026-07-01",
            effectiveTo: "2026-07-31",
          },
        },
      },
    });
    signInAs(data.expert);

    const created = await POST(request("POST", {
      businessDate: "2026-08-29",
      position: "EXPERT",
      channelId: data.channelId,
      // 两个来源故意选择不匹配当前岗位的人，验证专家来源不再按岗位标签过滤。
      sourceReceptionId: historicalMember.id,
      sourceGroupOperatorId: data.reception.id,
      values: { ...emptyValues, expertReceivedCount: 2, expertContactedCount: 1 },
    }));

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      entry: {
        sourceReceptionId: historicalMember.id,
        sourceGroupOperatorId: data.reception.id,
      },
    });

    const foreignGroupId = `${prefix}foreign-group-${suffix}`;
    const departmentId = (await db.teamGroup.findUniqueOrThrow({ where: { id: data.groupId } })).departmentId;
    await db.teamGroup.create({ data: { id: foreignGroupId, name: "其他小组", departmentId, timezone: "UTC" } });
    const foreignMember = await db.user.create({
      data: { id: `${prefix}foreign-${suffix}`, username: `${prefix}foreign-${suffix}`, name: "其他组成员", role: "RECEPTION", groupId: foreignGroupId },
    });
    const rejected = await POST(request("POST", {
      businessDate: "2026-08-28",
      position: "EXPERT",
      channelId: data.channelId,
      sourceReceptionId: foreignMember.id,
      sourceGroupOperatorId: data.reception.id,
      values: { ...emptyValues, expertReceivedCount: 1 },
    }));
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: "来源接粉不属于该小组的现任或历史成员" });
  });

  it("locks number-tracked progress but keeps member-entered official finance from the cutover date", async () => {
    const data = await fixture();
    signInAs(data.reception);

    const created = await POST(request("POST", {
      businessDate: "2026-09-02",
      position: "RECEPTION",
      channelId: data.channelId,
      values: {
        ...emptyValues,
        dispatchCount: 20,
        replyCount: 8,
        joinCount: 3,
        normalLeaveCount: 1,
        expertIntroCount: 2,
        registrationCount: 1,
        orderCount: 1,
        cryptoInitialDepositCents: 100_000,
        cryptoRechargeCents: 50_000,
        withdrawalCents: 10_000,
      },
    }));

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      entry: {
        currentRevision: {
          dispatchCount: 20,
          replyCount: 8,
          joinCount: 0,
          normalLeaveCount: 0,
          expertIntroCount: 0,
          registrationCount: 0,
          orderCount: 0,
          cryptoInitialDepositCents: 100_000,
          cryptoRechargeCents: 50_000,
          withdrawalCents: 10_000,
        },
      },
    });
  });
});
