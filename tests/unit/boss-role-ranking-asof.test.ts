import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadRoleRankings } from "../../src/lib/analytics/role-rankings";
import { loadMemberDailyDetail } from "../../src/lib/analytics/member-daily-detail";
import { loadSourcePerformanceSummary } from "../../src/lib/source-performance-summary";
import { db } from "../../src/lib/db";

const prefix = "boss-role-asof-";

async function fixture() {
  const groupId = `${prefix}group-${randomUUID()}`;
  const channelId = `${prefix}channel-${randomUUID()}`;
  const batchId = `${prefix}batch-${randomUUID()}`;
  await db.teamGroup.create({ data: { id: groupId, name: `${prefix}${randomUUID()}` } });
  const [reception, operatorA, operatorB, expert] = await Promise.all([
    db.user.create({ data: { id: `${prefix}reception-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "接粉甲", role: "RECEPTION", groupId } }),
    db.user.create({ data: { id: `${prefix}operator-a-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "炒群甲", role: "GROUP_OPERATOR", groupId } }),
    db.user.create({ data: { id: `${prefix}operator-b-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "炒群乙", role: "GROUP_OPERATOR", groupId } }),
    db.user.create({ data: { id: `${prefix}expert-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "专家甲", role: "EXPERT", groupId } }),
  ]);
  await db.groupOperatorReception.create({ data: { groupOperatorId: operatorB.id, receptionistId: reception.id } });
  await db.channel.create({ data: { id: channelId, groupId, name: "测试渠道", normalizedName: `${prefix}${randomUUID()}` } });
  await db.sourceBatch.create({ data: { id: batchId, groupId, channelId, sourceDate: "2026-08-01" } });
  return { groupId, batchId, reception, operatorA, operatorB, expert };
}

afterEach(async () => {
  await db.invalidFanReportAudit.deleteMany({ where: { report: { batchId: { startsWith: prefix } } } });
  await db.invalidFanReport.deleteMany({ where: { batchId: { startsWith: prefix } } });
  const leads = await db.leadCustomer.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const leadIds = leads.map((lead) => lead.id);
  await db.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.customerOrder.deleteMany({ where: { leadId: { in: leadIds } } });
  await db.leadCustomer.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.sourceBatch.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { id: { startsWith: prefix } } });
  const users = await db.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await db.groupOperatorReception.deleteMany({ where: { OR: [{ groupOperatorId: { in: userIds } }, { receptionistId: { in: userIds } }] } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("老板简报岗位统计截止日", () => {
  it("不会把报告日之后的回复、推专家、注册和开单算进历史日报", async () => {
    const fixtureData = await fixture();
    const lead = await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: fixtureData.batchId,
        ownerId: fixtureData.reception.id,
        groupOperatorOwnerId: fixtureData.operatorA.id,
        expertOwnerId: fixtureData.expert.id,
        repliedOn: "2026-08-17",
        replyStatus: "REPLIED",
        joinedOn: "2026-08-10",
        groupStatus: "JOINED",
        expertIntroducedOn: "2026-08-17",
        expertContactedOn: "2026-08-17",
        registeredOn: "2026-08-17",
      },
    });
    await db.leadActivity.create({ data: { leadId: lead.id, actorId: fixtureData.operatorA.id, kind: "EXPERT_INTRODUCED", occurredOn: "2026-08-17" } });
    await db.customerOrder.create({ data: { phone: lead.phone, batchId: fixtureData.batchId, enteredById: fixtureData.expert.id, openedOn: "2026-08-17", initialDepositCents: 10_000, leadId: lead.id } });

    const result = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16", today: "2026-08-16" });
    expect(result.reception[0]).toMatchObject({ valid: 1, replied: 0, joined: 1, expertIntroduced: 0, registered: 0, orders: 0 });
    expect(result.groupOperators.find((row) => row.id === fixtureData.operatorA.id)).toMatchObject({ sharedCustomerCount: 1, introducedEligible: 0 });
    expect(result.groupOperators.find((row) => row.id === fixtureData.operatorB.id)).toMatchObject({ sharedCustomerCount: 0 });
    expect(result.experts[0]).toMatchObject({ contacted: 0, registered: 0, orders: 0, eligibleForOrder: 0, orderedEligible: 0 });
  });

  it("接粉员改配后，已有客户仍归原炒群负责人", async () => {
    const fixtureData = await fixture();
    const lead = await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: fixtureData.batchId,
        ownerId: fixtureData.reception.id,
        groupOperatorOwnerId: fixtureData.operatorA.id,
        joinedOn: "2026-08-10",
        groupStatus: "JOINED",
        expertIntroducedOn: "2026-08-15",
      },
    });
    await db.leadActivity.create({ data: { leadId: lead.id, actorId: fixtureData.operatorA.id, kind: "EXPERT_INTRODUCED", occurredOn: "2026-08-15" } });

    const result = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16", today: "2026-08-16" });
    expect(result.groupOperators.find((row) => row.id === fixtureData.operatorA.id)).toMatchObject({ sharedCustomerCount: 1, introducedEligible: 1 });
    expect(result.groupOperators.find((row) => row.id === fixtureData.operatorB.id)).toMatchObject({ sharedCustomerCount: 0, introducedEligible: 0 });
  });

  it("同一笔首充会展示给接粉、粉归属、炒群和专家，但小组总账只计算一次", async () => {
    const fixtureData = await fixture();
    const lead = await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: fixtureData.batchId,
        ownerId: fixtureData.reception.id,
        attributionOwnerId: fixtureData.operatorB.id,
        groupOperatorOwnerId: fixtureData.operatorA.id,
        expertOwnerId: fixtureData.expert.id,
        repliedOn: "2026-08-10",
        replyStatus: "REPLIED",
        joinedOn: "2026-08-10",
        groupStatus: "JOINED",
        expertIntroducedOn: "2026-08-11",
        expertContactedOn: "2026-08-11",
        registeredOn: "2026-08-12",
      },
    });
    await db.customerOrder.create({
      data: { phone: lead.phone, batchId: fixtureData.batchId, enteredById: fixtureData.expert.id, leadId: lead.id, openedOn: "2026-08-16", initialDepositCents: 10_000 },
    });

    const result = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-01", today: "2026-08-16" });
    expect(result.reception.find((row) => row.id === fixtureData.reception.id)).toMatchObject({ firstDepositCents: 10_000, depositCents: 10_000 });
    expect(result.fanOwners?.find((row) => row.id === fixtureData.operatorB.id)).toMatchObject({ firstDepositCents: 10_000, depositCents: 10_000 });
    expect(result.groupOperators.find((row) => row.id === fixtureData.operatorA.id)).toMatchObject({ firstDepositCents: 10_000, depositCents: 10_000, netCents: 10_000 });
    expect(result.experts.find((row) => row.id === fixtureData.expert.id)).toMatchObject({ firstDepositCents: 10_000, depositCents: 10_000, netCents: 10_000 });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ firstDepositCents: 10_000, depositCents: 10_000 });
  });

  it("只把组长已审核的无效粉数字计入接粉员统计", async () => {
    const fixtureData = await fixture();
    const pending = await db.invalidFanReport.create({
      data: {
        batchId: fixtureData.batchId,
        reporterId: fixtureData.reception.id,
        noWsCount: 2,
        lowAmountCount: 3,
        collisionCount: 4,
      },
    });

    let result = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-01", today: "2026-08-01" });
    expect(result.reception.find((row) => row.id === fixtureData.reception.id)).toMatchObject({ total: 0, noWs: 0, lowAmount: 0, duplicate: 0, invalid: 0 });

    await db.invalidFanReport.update({
      where: { id: pending.id },
      data: {
        status: "APPROVED",
        approvedNoWsCount: 2,
        approvedLowAmountCount: 3,
        approvedCollisionCount: 4,
      },
    });
    result = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-01", today: "2026-08-01" });
    expect(result.reception.find((row) => row.id === fixtureData.reception.id)).toMatchObject({ total: 9, noWs: 2, lowAmount: 3, duplicate: 4, invalid: 0, valid: 0 });
  });

  it("接粉员每日明细也只显示审核后的无效粉数字", async () => {
    const fixtureData = await fixture();
    await db.invalidFanReport.create({
      data: {
        batchId: fixtureData.batchId,
        reporterId: fixtureData.reception.id,
        status: "APPROVED",
        noWsCount: 1,
        lowAmountCount: 2,
        collisionCount: 3,
        approvedNoWsCount: 1,
        approvedLowAmountCount: 2,
        approvedCollisionCount: 3,
      },
    });
    const detail = await loadMemberDailyDetail({
      groupIds: [fixtureData.groupId],
      memberId: fixtureData.reception.id,
      role: "RECEPTION",
      from: "2026-08-01",
      to: "2026-08-01",
    });
    expect(detail?.rows[0]).toMatchObject({ added: 6, valid: 0, noWs: 1, lowAmount: 2, duplicate: 3 });
  });

  it("来源业绩汇总把审核通过的无效粉放进添加数据，但不算作有效客户", async () => {
    const fixtureData = await fixture();
    await db.invalidFanReport.create({
      data: {
        batchId: fixtureData.batchId,
        reporterId: fixtureData.reception.id,
        status: "APPROVED",
        noWsCount: 1,
        lowAmountCount: 1,
        collisionCount: 1,
        approvedNoWsCount: 1,
        approvedLowAmountCount: 1,
        approvedCollisionCount: 1,
      },
    });
    const rows = await loadSourcePerformanceSummary({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-01", today: "2026-08-01" });
    expect(rows.find((row) => row.channelType === "SMS")).toMatchObject({ added: 3, effective: 0 });
  });
});
