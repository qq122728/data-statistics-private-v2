import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// This script is deliberately limited to the local development SQLite database.
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
  throw new Error("公司小组演示数据只能写入本地 SQLite 数据库。");
}

const db = new PrismaClient({
  datasourceUrl: `file:${resolve(process.cwd(), "prisma/dev.db")}`,
});

const groups = [
  { id: "demo-company-group-b", name: "B组", channelId: "demo-company-b-channel", channelName: "演示-B组-投流", price: 2_800 },
  { id: "demo-company-group-c", name: "C组", channelId: "demo-company-c-channel", channelName: "演示-C组-短信", price: 4_200 },
];

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function day(offset) {
  const value = new Date(Date.UTC(2026, 7, 12 + offset));
  return value.toISOString().slice(0, 10);
}

async function clearExistingDemo() {
  const groupIds = groups.map((group) => group.id);
  const batches = await db.sourceBatch.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } });
  const batchIds = batches.map((batch) => batch.id);
  const leads = batchIds.length
    ? await db.leadCustomer.findMany({ where: { batchId: { in: batchIds } }, select: { id: true } })
    : [];
  const leadIds = leads.map((lead) => lead.id);
  const members = await db.user.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } });
  const memberIds = members.map((member) => member.id);

  await db.$transaction(async (tx) => {
    await tx.metricEvent.deleteMany({ where: { batchId: { in: batchIds } } });
    await tx.customerOrder.deleteMany({ where: { batchId: { in: batchIds } } });
    await tx.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } });
    await tx.leadCustomer.deleteMany({ where: { id: { in: leadIds } } });
    await tx.sourceBatch.deleteMany({ where: { id: { in: batchIds } } });
    await tx.channel.deleteMany({ where: { groupId: { in: groupIds } } });
    await tx.groupOperatorReception.deleteMany({
      where: { OR: [{ groupOperatorId: { in: memberIds } }, { receptionistId: { in: memberIds } }] },
    });
    await tx.user.deleteMany({ where: { id: { in: memberIds } } });
    await tx.teamGroup.deleteMany({ where: { id: { in: groupIds } } });
  });
}

async function seedGroup(group, groupIndex) {
  const suffix = groupIndex === 0 ? "b" : "c";
  const users = {
    lead: `demo-${suffix}-lead`,
    reception: `demo-${suffix}-reception`,
    operator: `demo-${suffix}-operator`,
    expert: `demo-${suffix}-expert`,
  };

  await db.teamGroup.create({ data: { id: group.id, name: group.name, departmentId: "department-a", timezone: "America/New_York" } });
  await db.user.createMany({ data: [
    { id: users.lead, employeeCode: `demo_${suffix}_lead`, username: `demo_${suffix}_lead`, name: `${group.name}演示组长`, passwordHash: hashPassword("Demo@56790"), role: "LEAD", groupId: group.id, hireDate: "2026-08-01" },
    { id: users.reception, employeeCode: `demo_${suffix}_reception`, username: `demo_${suffix}_reception`, name: `${group.name}演示接粉`, passwordHash: hashPassword("Demo@56790"), role: "RECEPTION", groupId: group.id, hireDate: "2026-08-01" },
    { id: users.operator, employeeCode: `demo_${suffix}_operator`, username: `demo_${suffix}_operator`, name: `${group.name}演示炒群`, passwordHash: hashPassword("Demo@56790"), role: "GROUP_OPERATOR", groupId: group.id, hireDate: "2026-08-01" },
    { id: users.expert, employeeCode: `demo_${suffix}_expert`, username: `demo_${suffix}_expert`, name: `${group.name}演示专家`, passwordHash: hashPassword("Demo@56790"), role: "EXPERT", groupId: group.id, hireDate: "2026-08-01" },
  ] });
  await db.userGroupMembership.createMany({ data: [
    { userId: users.lead, groupId: group.id, role: "LEAD", effectiveFrom: "2026-08-01", reason: "本地演示数据" },
    { userId: users.reception, groupId: group.id, role: "RECEPTION", effectiveFrom: "2026-08-01", reason: "本地演示数据" },
    { userId: users.operator, groupId: group.id, role: "GROUP_OPERATOR", effectiveFrom: "2026-08-01", reason: "本地演示数据" },
    { userId: users.expert, groupId: group.id, role: "EXPERT", effectiveFrom: "2026-08-01", reason: "本地演示数据" },
  ] });
  await db.groupOperatorReception.create({ data: { groupOperatorId: users.operator, receptionistId: users.reception } });
  await db.channel.create({
    data: {
      id: group.channelId,
      groupId: group.id,
      name: group.channelName,
      normalizedName: group.channelName.toLowerCase(),
      createdById: users.lead,
      fanCostMode: "PAID",
      effectiveFanPriceCents: group.price,
    },
  });

  const batches = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
    const sourceDate = day(index);
    return db.sourceBatch.create({
      data: {
        id: `${group.id}-batch-${sourceDate}`,
        groupId: group.id,
        channelId: group.channelId,
        sourceDate,
        fanCostModeSnapshot: "PAID",
        effectiveFanPriceCentsSnapshot: group.price,
      },
    });
  }));

  const leads = [];
  const activities = [];
  const orders = [];
  for (let index = 0; index < 84; index += 1) {
    const stage = index % 12;
    const sourceDate = day(index % 7);
    const batch = batches[index % batches.length];
    const joinedOn = day(Math.min(6, (index % 7) + 1));
    const introducedOn = day(Math.min(6, (index % 7) + 2));
    const contactedOn = day(Math.min(6, (index % 7) + 3));
    const registeredOn = day(Math.min(6, (index % 7) + 4));
    const phone = `${groupIndex === 0 ? "18881" : "18882"}${String(index + 1).padStart(6, "0")}`;
    const id = `${group.id}-lead-${index + 1}`;
    const lead = {
      id,
      phone,
      batchId: batch.id,
      ownerId: users.reception,
      groupOperatorOwnerId: users.operator,
      customerName: `${group.name}演示客户 ${String(index + 1).padStart(3, "0")}`,
      receptionCategory: stage === 0 ? "LOW_AMOUNT" : stage === 1 ? "NO_WS" : stage === 2 ? "INVALID" : "VALID",
      invalidReason: stage === 0 ? "演示：金额低于 $5,000" : stage === 1 ? "演示：没有 WhatsApp" : stage === 2 ? "演示：号码无效" : null,
      lossAmountCents: stage === 0 ? 320_000 : null,
      replyStatus: stage >= 3 ? "REPLIED" : "NOT_REPLIED",
      repliedOn: stage >= 3 ? day(Math.min(6, (index % 7) + 1)) : null,
      groupStatus: stage >= 5 ? (stage === 5 ? "LEFT" : "JOINED") : "NOT_JOINED",
      joinedOn: stage >= 5 ? joinedOn : null,
      leftOn: stage === 5 ? day(6) : null,
      leftWithOrder: stage === 5 ? false : null,
      expertIntroducedOn: stage >= 7 ? introducedOn : null,
      expertOwnerId: stage >= 7 ? users.expert : null,
      expertContactedOn: stage >= 8 ? contactedOn : null,
      expertContactNote: stage >= 8 ? "演示：已联系，等待注册" : null,
      registeredOn: stage >= 9 ? registeredOn : null,
      nextPlan: stage >= 9 && stage < 10 ? "提醒客户完成首充" : null,
      noInitialDepositOn: stage === 9 ? day(6) : null,
      noInitialDepositReason: stage === 9 ? "仍在观望" : null,
      noInitialDepositNote: stage === 9 ? "演示：已注册但暂未首充" : null,
      expertStalledOn: stage === 11 ? day(6) : null,
      expertStalledReason: stage === 11 ? "资金不足" : null,
      expertStalledNote: stage === 11 ? "演示：已开单，暂时杀不动" : null,
      notes: "本地演示数据：用于查看公司管理员的多小组报表。",
    };
    leads.push(lead);
    if (stage >= 3) activities.push({ leadId: id, actorId: users.reception, kind: "REPLIED", occurredOn: lead.repliedOn, note: "演示：客户已回复" });
    if (stage >= 5) activities.push({ leadId: id, actorId: users.reception, kind: "JOINED_GROUP", occurredOn: joinedOn, note: "演示：已确认入群" });
    if (stage === 5) activities.push({ leadId: id, actorId: users.operator, kind: "LEFT_GROUP", occurredOn: day(6), note: "演示：提前退群" });
    if (stage >= 7) activities.push({ leadId: id, actorId: users.operator, kind: "EXPERT_INTRODUCED", occurredOn: introducedOn, note: "演示：已推专家" });
    if (stage >= 8) activities.push({ leadId: id, actorId: users.expert, kind: "EXPERT_CONTACTED", occurredOn: contactedOn, note: "演示：专家已联系" });
    if (stage >= 9) activities.push({ leadId: id, actorId: users.expert, kind: "REGISTERED", occurredOn: registeredOn, note: "演示：已注册" });
    if (stage >= 10) orders.push({ id: `${id}-order`, leadId: id, phone, batchId: batch.id, enteredById: users.expert, openedOn: day(6), initialDepositCents: (groupIndex === 0 ? 160_000 : 90_000) + (index % 4) * 25_000, stage });
  }

  await db.$transaction(async (tx) => {
    await tx.leadCustomer.createMany({ data: leads });
    await tx.leadActivity.createMany({ data: activities });
    for (const order of orders) {
      await tx.customerOrder.create({ data: { id: order.id, leadId: order.leadId, phone: order.phone, batchId: order.batchId, enteredById: order.enteredById, openedOn: order.openedOn, initialDepositCents: order.initialDepositCents } });
      if (order.stage === 11) await tx.metricEvent.create({ data: { batchId: order.batchId, enteredById: users.expert, occurredOn: day(6), kind: "RECHARGE", amountCents: 45_000, customerOrderId: order.id, continuationNumber: 1 } });
    }
  });
  return { group: group.name, leads: leads.length, orders: orders.length };
}

async function main() {
  await clearExistingDemo();
  const results = [];
  for (const [index, group] of groups.entries()) results.push(await seedGroup(group, index));
  console.log(JSON.stringify({ action: "已在 A公司创建 B组、C组及模拟数据", results }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
