import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { POST as TRANSFER } from "../../src/app/api/admin/users/transfer/route";

const prefix = "user-position-transfer-";

async function fixture() {
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } });
  vi.spyOn(auth, "requireRole").mockResolvedValue(admin);
  const groupA = `${prefix}a-${randomUUID()}`;
  const groupB = `${prefix}b-${randomUUID()}`;
  const leaderId = `${prefix}leader-${randomUUID()}`;
  const userId = `${prefix}user-${randomUUID()}`;
  const channelId = `${prefix}channel-${randomUUID()}`;
  await db.teamGroup.createMany({ data: [{ id: groupA, name: `冻结A组-${randomUUID()}` }, { id: groupB, name: `冻结B组-${randomUUID()}` }] });
  await db.user.create({ data: { id: leaderId, username: `${prefix}${randomUUID()}`, name: "A组组长", role: "LEAD", groupId: groupA } });
  await db.user.create({
    data: {
      id: userId,
      username: `${prefix}${randomUUID()}`,
      name: "专家AA",
      role: "EXPERT",
      groupId: groupA,
      membershipHistory: { create: { groupId: groupA, role: "EXPERT", effectiveFrom: "2026-08-01", reason: "入职A组" } },
      positionHistory: { create: { groupId: groupA, position: "EXPERT", effectiveFrom: "2026-08-01", reason: "入职A组" } },
    },
  });
  await db.channel.create({ data: { id: channelId, groupId: groupA, name: "冻结测试渠道", normalizedName: `${prefix}${randomUUID()}` } });
  const batch = await db.sourceBatch.create({ data: { groupId: groupA, channelId, sourceDate: "2026-08-05" } });
  return { groupA, groupB, leaderId, userId, batchId: batch.id };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: userIds } }, { actorId: { in: userIds } }] } });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.customerOrder.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.userPosition.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("transferUserPosition 岗位冻结", () => {
  it("调组后关闭旧的 UserPosition 行、开一条新的，历史行不变", async () => {
    const data = await fixture();
    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "调至B组继续担任专家" }),
    }));
    expect(response.status).toBe(200);

    const history = await db.userPosition.findMany({ where: { userId: data.userId }, orderBy: { effectiveFrom: "asc" } });
    expect(history).toMatchObject([
      { groupId: data.groupA, position: "EXPERT", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-15" },
      { groupId: data.groupB, position: "EXPERT", effectiveFrom: "2026-08-16", effectiveTo: null },
    ]);
  });

  it("转为组长时不写 UserPosition 行，只设置 User.duty；转回工作岗位后清空 duty 并重新开一条历史行", async () => {
    const data = await fixture();
    // B组没有在职组长，避免和 fixture 里 A组已有的组长冲突。
    const toLead = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "LEAD", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "升级为B组组长" }),
    }));
    expect(toLead.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({ where: { id: data.userId }, select: { duty: true } })).resolves.toEqual({ duty: "LEAD" });
    const afterPromotion = await db.userPosition.findMany({ where: { userId: data.userId }, orderBy: { effectiveFrom: "asc" } });
    expect(afterPromotion).toMatchObject([{ groupId: data.groupA, position: "EXPERT", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-15" }]);

    const backToExpert = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-20", reason: "改任B组专家" }),
    }));
    expect(backToExpert.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({ where: { id: data.userId }, select: { duty: true } })).resolves.toEqual({ duty: null });
    const afterReturn = await db.userPosition.findMany({ where: { userId: data.userId }, orderBy: { effectiveFrom: "asc" } });
    expect(afterReturn).toMatchObject([
      { groupId: data.groupA, position: "EXPERT", effectiveFrom: "2026-08-01", effectiveTo: "2026-08-15" },
      { groupId: data.groupB, position: "EXPERT", effectiveFrom: "2026-08-20", effectiveTo: null },
    ]);
  });

  it("未成交/停止维护客户自动划给原组组长，不需要指定接手人也不挡转岗", async () => {
    const data = await fixture();
    // ownerId（接粉归属）故意挂在组长名下，跟 expertOwnerId 区分开，避免这两个
    // 客户被"接粉在办"计数误伤挡住转岗——这里只测专家侧的放弃状态判定。
    // DECLINED_DEPOSIT（未成交）按需求文档8.2只能在开单前发生，不建 CustomerOrder；
    // STALLED（停止维护）按8.2只能在开单后发生，markExpertStalled 强制要求已开单
    // （见 mutations.ts:214），所以这里必须真建一笔 CustomerOrder，否则测的是一个
    // 业务上不可达的数据状态，会掩盖 customerOrder 相关的判断漏洞。
    const declinedPhone = `6${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`;
    const declined = await db.leadCustomer.create({
      data: { phone: declinedPhone, batchId: data.batchId, ownerId: data.leaderId, attributionOwnerId: data.leaderId, expertOwnerId: data.userId, expertIntroducedOn: "2026-08-06", registeredOn: "2026-08-07", expertWorkflowStage: "DECLINED_DEPOSIT", noInitialDepositOn: "2026-08-08", noInitialDepositReason: "NO_BUDGET" },
    });
    const stalledPhone = `5${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`;
    const stalled = await db.leadCustomer.create({
      data: { phone: stalledPhone, batchId: data.batchId, ownerId: data.leaderId, attributionOwnerId: data.leaderId, expertOwnerId: data.userId, expertIntroducedOn: "2026-08-06", registeredOn: "2026-08-07", expertWorkflowStage: "STALLED", expertStalledOn: "2026-08-09", expertStalledReason: "NO_RESPONSE" },
    });
    await db.customerOrder.create({ data: { phone: stalledPhone, batchId: data.batchId, enteredById: data.userId, openedOn: "2026-08-08", initialDepositCents: 500_000, leadId: stalled.id } });

    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "调至B组继续担任专家" }),
    }));
    expect(response.status).toBe(200);

    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: declined.id }, select: { expertOwnerId: true } })).resolves.toEqual({ expertOwnerId: data.leaderId });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: stalled.id }, select: { expertOwnerId: true } })).resolves.toEqual({ expertOwnerId: data.leaderId });
  });

  it("找不到原组在职组长时，放弃状态客户保持原样，不报错也不阻挡转岗", async () => {
    const data = await fixture();
    await db.user.update({ where: { id: data.leaderId }, data: { active: false } });
    const declined = await db.leadCustomer.create({
      data: { phone: `3${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: data.batchId, ownerId: data.leaderId, attributionOwnerId: data.leaderId, expertOwnerId: data.userId, expertIntroducedOn: "2026-08-06", registeredOn: "2026-08-07", expertWorkflowStage: "DECLINED_DEPOSIT", noInitialDepositOn: "2026-08-08", noInitialDepositReason: "NO_BUDGET" },
    });

    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "调至B组继续担任专家" }),
    }));
    expect(response.status).toBe(200);
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: declined.id }, select: { expertOwnerId: true } })).resolves.toEqual({ expertOwnerId: data.userId });
  });

  it("真正还在办的专家客户（未放弃）仍然需要指定接手人才能转岗", async () => {
    const data = await fixture();
    await db.leadCustomer.create({
      data: { phone: `4${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: data.batchId, ownerId: data.leaderId, attributionOwnerId: data.leaderId, expertOwnerId: data.userId, expertIntroducedOn: "2026-08-06", expertWorkflowStage: "TRACKING" },
    });

    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "调至B组继续担任专家" }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "还有 1 位专家阶段客户，请选择原小组专家接收人" });
  });

  it("刚推专家、还没进入任何放弃或推进阶段（expertWorkflowStage 为 null）的客户仍算在办", async () => {
    const data = await fixture();
    await db.leadCustomer.create({
      data: { phone: `2${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: data.batchId, ownerId: data.leaderId, attributionOwnerId: data.leaderId, expertOwnerId: data.userId, expertIntroducedOn: "2026-08-06", expertWorkflowStage: null },
    });

    const response = await TRANSFER(new Request("http://localhost/api/admin/users/transfer", {
      method: "POST",
      body: JSON.stringify({ userId: data.userId, targetGroupId: data.groupB, role: "EXPERT", secondaryRoles: [], effectiveOn: "2026-08-16", reason: "调至B组继续担任专家" }),
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "还有 1 位专家阶段客户，请选择原小组专家接收人" });
  });
});
