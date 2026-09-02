import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadRoleRankings } from "../../src/lib/analytics/role-rankings";
import { loadMemberDailyDetail } from "../../src/lib/analytics/member-daily-detail";
import { loadSourcePerformanceSummary } from "../../src/lib/source-performance-summary";
import { db } from "../../src/lib/db";

const prefix = "role-asof-";

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

describe.sequential("岗位统计截止日", () => {
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

  it("当前在群不受报表日期范围卡人群——早于 sourceDateFrom 到店、还没退群的客户照样算", async () => {
    const fixtureData = await fixture();
    const oldBatchId = `${prefix}old-batch-${randomUUID()}`;
    await db.sourceBatch.create({ data: { id: oldBatchId, groupId: fixtureData.groupId, channelId: (await db.sourceBatch.findUniqueOrThrow({ where: { id: fixtureData.batchId } })).channelId, sourceDate: "2026-07-01" } });
    await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: oldBatchId,
        ownerId: fixtureData.reception.id,
        groupOperatorOwnerId: fixtureData.operatorA.id,
        joinedOn: "2026-07-05",
        groupStatus: "JOINED",
      },
    });
    await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: fixtureData.batchId,
        ownerId: fixtureData.reception.id,
        groupOperatorOwnerId: fixtureData.operatorA.id,
        joinedOn: "2026-08-10",
        groupStatus: "JOINED",
      },
    });

    const wideRange = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-07-01", sourceDateTo: "2026-08-16", today: "2026-08-16" });
    const narrowRange = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16", today: "2026-08-16" });
    expect(wideRange.groupOperators.find((row) => row.id === fixtureData.operatorA.id)).toMatchObject({ currentInGroup: 2 });
    // 窄范围里 sharedCustomerCount 理应只剩1（旧批次不在选中范围内），但当前在群是快照，两次查询答案必须一样。
    expect(narrowRange.groupOperators.find((row) => row.id === fixtureData.operatorA.id)).toMatchObject({ sharedCustomerCount: 1, currentInGroup: 2 });
  });

  it("当前在群跟主榜单用同一套归属兜底——没有明确指派的客户按配对组长算，不会被漏成0", async () => {
    const fixtureData = await fixture();
    // fixture() 已经把 operatorB 配对到 reception；这条客户没有明确指派 groupOperatorOwnerId，
    // 只能靠"当前配对组长"这层兜底才能归到 operatorB 名下——如果快照查询漏了这层兜底就会算成0。
    await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: fixtureData.batchId,
        ownerId: fixtureData.reception.id,
        joinedOn: "2026-08-10",
        groupStatus: "JOINED",
      },
    });

    const result = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16", today: "2026-08-16" });
    expect(result.groupOperators.find((row) => row.id === fixtureData.operatorB.id)).toMatchObject({ currentInGroup: 1 });
  });

  it("炒群每日明细与主榜单共用三层归属——明确指派优先，其次最近推专家，最后当前配对", async () => {
    const fixtureData = await fixture();
    const createLead = async (suffix: string, groupOperatorOwnerId: string | null) => db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${suffix}-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: fixtureData.batchId,
        ownerId: fixtureData.reception.id,
        groupOperatorOwnerId,
        joinedOn: "2026-08-10",
        groupStatus: "JOINED",
      },
    });

    // 没有明确负责人和推专家动作，只能按 reception 当前配对归 operatorB。
    await createLead("paired", null);
    // 没有明确负责人，但最近推专家动作是 operatorA，动作归属优先于当前配对。
    const activityLead = await createLead("activity", null);
    await db.leadActivity.create({
      data: { leadId: activityLead.id, actorId: fixtureData.operatorA.id, kind: "EXPERT_INTRODUCED", occurredOn: "2026-08-12" },
    });
    // 明确负责人是 operatorB，即使 operatorA 做过推专家动作，也仍以明确负责人为准。
    const explicitLead = await createLead("explicit", fixtureData.operatorB.id);
    await db.leadActivity.create({
      data: { leadId: explicitLead.id, actorId: fixtureData.operatorA.id, kind: "EXPERT_INTRODUCED", occurredOn: "2026-08-13" },
    });

    const [ranking, detailA, detailB] = await Promise.all([
      loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16", today: "2026-08-16" }),
      loadMemberDailyDetail({ groupIds: [fixtureData.groupId], memberId: fixtureData.operatorA.id, role: "GROUP_OPERATOR", from: "2026-08-01", to: "2026-08-16" }),
      loadMemberDailyDetail({ groupIds: [fixtureData.groupId], memberId: fixtureData.operatorB.id, role: "GROUP_OPERATOR", from: "2026-08-01", to: "2026-08-16" }),
    ]);

    expect(ranking.groupOperators.find((row) => row.id === fixtureData.operatorA.id)).toMatchObject({ currentInGroup: 1 });
    expect(ranking.groupOperators.find((row) => row.id === fixtureData.operatorB.id)).toMatchObject({ currentInGroup: 2 });
    expect(detailA?.rows.find((row) => row.date === "2026-08-16")).toMatchObject({ inGroup: 1 });
    expect(detailB?.rows.find((row) => row.date === "2026-08-16")).toMatchObject({ inGroup: 2 });
  });

  it("快照归属到一个连组长身份都没有的人时，这个人也必须单独出现一行——不能因为进不了角色花名册筛选就把快照漏掉", async () => {
    const fixtureData = await fixture();
    const oldBatchId = `${prefix}old-batch-${randomUUID()}`;
    await db.sourceBatch.create({ data: { id: oldBatchId, groupId: fixtureData.groupId, channelId: (await db.sourceBatch.findUniqueOrThrow({ where: { id: fixtureData.batchId } })).channelId, sourceDate: "2026-07-01" } });
    // 这条客户没有明确指派组长，也没有配对组长兜底——只能靠"最近一次推专家动作"归到 expert 名下；
    // expert 角色本身不是 GROUP_OPERATOR，窄范围里这条客户所在的老批次也不在范围内，
    // 如果花名册筛选只看角色和范围内经手记录，expert 会连行都进不来，快照就凭空消失了。
    const lead = await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: oldBatchId,
        ownerId: fixtureData.reception.id,
        joinedOn: "2026-07-05",
        groupStatus: "JOINED",
      },
    });
    await db.leadActivity.create({ data: { leadId: lead.id, actorId: fixtureData.expert.id, kind: "EXPERT_INTRODUCED", occurredOn: "2026-07-10" } });

    const narrowRange = await loadRoleRankings({ groupIds: [fixtureData.groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-16", today: "2026-08-16" });
    expect(narrowRange.groupOperators.find((row) => row.id === fixtureData.expert.id)).toMatchObject({ currentInGroup: 1, sharedCustomerCount: 0 });
  });

  it("炒群每日明细的当日在群/可推专家也不受报表日期范围卡人群", async () => {
    const fixtureData = await fixture();
    const oldBatchId = `${prefix}old-batch-${randomUUID()}`;
    await db.sourceBatch.create({ data: { id: oldBatchId, groupId: fixtureData.groupId, channelId: (await db.sourceBatch.findUniqueOrThrow({ where: { id: fixtureData.batchId } })).channelId, sourceDate: "2026-07-01" } });
    await db.leadCustomer.create({
      data: {
        id: `${prefix}lead-${randomUUID()}`,
        phone: `1${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`,
        batchId: oldBatchId,
        ownerId: fixtureData.reception.id,
        groupOperatorOwnerId: fixtureData.operatorA.id,
        joinedOn: "2026-07-05",
        groupStatus: "JOINED",
      },
    });

    const detail = await loadMemberDailyDetail({
      groupIds: [fixtureData.groupId],
      memberId: fixtureData.operatorA.id,
      role: "GROUP_OPERATOR",
      from: "2026-08-01",
      to: "2026-08-16",
    });
    // 报表范围是08-01至08-16，早于范围的07-05入群客户在 leads 的[from,to]过滤里根本不会出现，
    // 但当日在群是快照，08-16这一行照样要把这个人算进去。
    expect(detail?.rows.find((row) => row.date === "2026-08-16")).toMatchObject({ inGroup: 1 });
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
