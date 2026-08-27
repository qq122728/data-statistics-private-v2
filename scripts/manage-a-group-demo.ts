import { db } from "../src/lib/db";
import { addLocalDays } from "../src/lib/dates";

const groupId = "group-a";
const demoPrefix = "演示-A组-";
const receptionUsernames = ["reception", "reception_b", "reception_c", "reception_d", "reception_e", "reception_f"];
const operatorByReception = new Map([
  ["reception", "operator"],
  ["reception_b", "operator"],
  ["reception_c", "operator"],
  ["reception_d", "operator_b"],
  ["reception_e", "operator_b"],
  ["reception_f", "operator_b"],
]);

const channels = [
  { id: "demo-a-group-ads", name: `${demoPrefix}投流渠道`, normalizedName: "demo-a-group-ads", price: 3_500 },
  { id: "demo-a-group-sms", name: `${demoPrefix}短信渠道`, normalizedName: "demo-a-group-sms", price: 1_800 },
];

function dateAt(offset: number) {
  return addLocalDays("2026-08-03", offset) ?? "2026-08-18";
}

async function clearDemoData() {
  const demoChannels = await db.channel.findMany({
    where: { groupId, name: { startsWith: demoPrefix } },
    select: { id: true },
  });
  const channelIds = demoChannels.map((channel) => channel.id);
  if (!channelIds.length) return { batches: 0, leads: 0 };

  const batches = await db.sourceBatch.findMany({
    where: { groupId, channelId: { in: channelIds } },
    select: { id: true },
  });
  const batchIds = batches.map((batch) => batch.id);
  const leads = await db.leadCustomer.findMany({
    where: { batchId: { in: batchIds } },
    select: { id: true },
  });
  const leadIds = leads.map((lead) => lead.id);

  await db.$transaction(async (tx) => {
    await tx.metricEvent.deleteMany({ where: { batchId: { in: batchIds } } });
    await tx.customerOrder.deleteMany({ where: { batchId: { in: batchIds } } });
    await tx.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } });
    await tx.leadException.deleteMany({ where: { batchId: { in: batchIds } } });
    await tx.leadCustomer.deleteMany({ where: { id: { in: leadIds } } });
    await tx.sourceBatch.deleteMany({ where: { id: { in: batchIds } } });
    await tx.channel.deleteMany({ where: { id: { in: channelIds }, groupId } });
  });
  return { batches: batchIds.length, leads: leadIds.length };
}

async function seedDemoData() {
  await clearDemoData();

  const people = await db.user.findMany({
    where: { username: { in: [...receptionUsernames, "operator", "operator_b", "expert", "lead"] }, active: true, groupId },
    select: { id: true, username: true },
  });
  const byUsername = new Map(people.map((person) => [person.username, person]));
  const required = [...receptionUsernames, "operator", "operator_b", "expert", "lead"];
  if (required.some((username) => !byUsername.has(username)))
    throw new Error("A组 10 名演示成员未齐全，请先创建团队账号");

  await db.channel.createMany({
    data: channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      normalizedName: channel.normalizedName,
      groupId,
      createdById: byUsername.get("lead")!.id,
      fanCostMode: "PAID",
      effectiveFanPriceCents: channel.price,
    })),
  });

  const batchByKey = new Map<string, { id: string; sourceDate: string; channelId: string }>();
  for (let dayOffset = 0; dayOffset < 16; dayOffset += 1) {
    for (const channel of channels) {
      const sourceDate = dateAt(dayOffset);
      const batch = await db.sourceBatch.create({
        data: {
          id: `demo-a-batch-${channel.id}-${sourceDate}`,
          groupId,
          channelId: channel.id,
          sourceDate,
          fanCostModeSnapshot: "PAID",
          effectiveFanPriceCentsSnapshot: channel.price,
        },
        select: { id: true, sourceDate: true, channelId: true },
      });
      batchByKey.set(`${channel.id}:${sourceDate}`, batch);
    }
  }

  const leads: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const orders: Array<{ id: string; leadId: string; phone: string; batchId: string; enteredById: string; openedOn: string; initialDepositCents: number; hasRecharge: boolean; hasWithdrawal: boolean }> = [];

  for (let index = 0; index < 216; index += 1) {
    const receptionUsername = receptionUsernames[index % receptionUsernames.length];
    const owner = byUsername.get(receptionUsername)!;
    const operator = byUsername.get(operatorByReception.get(receptionUsername)!)!;
    const sourceDate = dateAt(index % 16);
    const channel = channels[index % channels.length];
    const batch = batchByKey.get(`${channel.id}:${sourceDate}`)!;
    const stage = index % 24;
    const phone = `1997${String(5_000_000 + index).padStart(7, "0")}`;
    const joinedOn = addLocalDays(sourceDate, 1 + (index % 4));
    const repliedOn = addLocalDays(sourceDate, 1);
    const introducedOn = joinedOn ? addLocalDays(joinedOn, 2) : null;
    const contactedOn = introducedOn ? addLocalDays(introducedOn, 1) : null;
    const registeredOn = contactedOn ? addLocalDays(contactedOn, 1) : null;
    const expert = index % 3 === 0 ? byUsername.get("lead")! : byUsername.get("expert")!;

    const lead: Record<string, unknown> = {
      id: `demo-a-lead-${index + 1}`,
      phone,
      batchId: batch.id,
      ownerId: owner.id,
      groupOperatorOwnerId: operator.id,
      customerName: `演示客户 ${String(index + 1).padStart(3, "0")}`,
      notes: stage >= 11 ? "演示数据：用于查看各岗位流程和颜色状态" : "演示数据：等待接粉处理",
      receptionCategory: "VALID",
      invalid: false,
      replyStatus: "NOT_REPLIED",
      followUpCount: stage >= 3 && stage <= 6 ? 1 + (index % 3) : 0,
    };

    if (stage === 0) Object.assign(lead, { receptionCategory: "INVALID", invalidReason: "演示：号码无效" });
    if (stage === 1) Object.assign(lead, { receptionCategory: "LOW_AMOUNT", lossAmountCents: 320_000, invalidReason: "演示：金额低于 $5,000" });
    if (stage === 2) Object.assign(lead, { receptionCategory: "NO_WS", invalidReason: "演示：无 WhatsApp" });
    if (stage >= 7) Object.assign(lead, { replyStatus: "REPLIED", repliedOn, lastFollowedUpOn: repliedOn });
    if (stage >= 11) Object.assign(lead, { groupStatus: stage === 16 || stage === 17 ? "LEFT" : "JOINED", joinedOn });
    if (stage === 16) Object.assign(lead, { leftOn: joinedOn ? addLocalDays(joinedOn, 4) : sourceDate, leftWithOrder: false, notes: "演示：第 4 天提前退群，未开单" });
    if (stage === 17) Object.assign(lead, { leftOn: joinedOn ? addLocalDays(joinedOn, 15) : sourceDate, leftWithOrder: true, notes: "演示：退群后仍由专家跟进，后续开单" });
    if (stage >= 17) Object.assign(lead, { expertIntroducedOn: introducedOn, expertOwnerId: expert.id });
    if (stage >= 19) Object.assign(lead, { expertContactedOn: contactedOn, expertContactNote: "演示：已联系，正在引导注册" });
    if (stage >= 20) Object.assign(lead, { registeredOn, nextPlan: stage === 20 ? "提醒客户完成首充" : "继续跟进资金情况", nextFollowUpOn: "2026-08-19" });
    if (stage === 20) Object.assign(lead, { noInitialDepositOn: "2026-08-18", noInitialDepositReason: "观望", noInitialDepositNote: "演示：已注册，暂未首充" });
    if (stage === 23) Object.assign(lead, { expertStalledOn: "2026-08-18", expertStalledReason: "资金不足", expertStalledNote: "演示：已开单但暂时无法继续推进" });
    leads.push(lead);

    if (stage >= 7) activities.push({ leadId: lead.id, actorId: owner.id, kind: "REPLIED", occurredOn: repliedOn!, note: "演示：客户已真实回复" });
    if (stage >= 11) {
      activities.push({ leadId: lead.id, actorId: owner.id, kind: "JOINED_GROUP", occurredOn: joinedOn!, note: "演示：已确认入群" });
      if (stage !== 16 && index % 2 === 0) activities.push({ leadId: lead.id, actorId: operator.id, kind: "GROUP_PROGRESS_UPDATED", occurredOn: "2026-08-18", note: "演示：群内互动正常，持续推进沟通" });
    }
    if (stage === 16 || stage === 17) activities.push({ leadId: lead.id, actorId: operator.id, kind: "LEFT_GROUP", occurredOn: stage === 16 ? (joinedOn ? addLocalDays(joinedOn, 4)! : sourceDate) : (joinedOn ? addLocalDays(joinedOn, 15)! : sourceDate), note: "演示：已标记退群" });
    if (stage >= 17) activities.push({ leadId: lead.id, actorId: operator.id, kind: "EXPERT_INTRODUCED", occurredOn: introducedOn!, note: `演示：已介绍给${expert.username === "lead" ? "组长代专家" : "前台专家 A"}` });
    if (stage >= 19) activities.push({ leadId: lead.id, actorId: expert.id, kind: "EXPERT_CONTACTED", occurredOn: contactedOn!, note: "演示：专家已联系客户" });
    if (stage >= 20) activities.push({ leadId: lead.id, actorId: expert.id, kind: "REGISTERED", occurredOn: registeredOn!, note: "演示：客户已注册" });

    if (stage >= 21) {
      const openedOn = addLocalDays(registeredOn!, 1)!;
      orders.push({
        id: `demo-a-order-${index + 1}`,
        leadId: lead.id as string,
        phone,
        batchId: batch.id,
        enteredById: expert.id,
        openedOn,
        initialDepositCents: 80_000 + (index % 8) * 20_000,
        hasRecharge: stage === 22 || stage === 23,
        hasWithdrawal: stage === 22,
      });
    }
  }

  await db.$transaction(async (tx) => {
    await tx.leadCustomer.createMany({ data: leads as never[] });
    await tx.leadActivity.createMany({ data: activities as never[] });
    for (const order of orders) {
      await tx.customerOrder.create({
        data: {
          id: order.id,
          leadId: order.leadId,
          phone: order.phone,
          batchId: order.batchId,
          enteredById: order.enteredById,
          openedOn: order.openedOn,
          initialDepositCents: order.initialDepositCents,
        },
      });
      if (order.hasRecharge) await tx.metricEvent.create({
        data: { batchId: order.batchId, enteredById: order.enteredById, occurredOn: order.openedOn, kind: "RECHARGE", amountCents: 40_000, customerOrderId: order.id, continuationNumber: 1 },
      });
      if (order.hasWithdrawal) await tx.metricEvent.create({
        data: { batchId: order.batchId, enteredById: order.enteredById, occurredOn: "2026-08-18", kind: "WITHDRAWAL", amountCents: 15_000, customerOrderId: order.id },
      });
    }
  });

  return { leads: leads.length, batches: batchByKey.size, orders: orders.length, activities: activities.length };
}

async function main() {
  const clearOnly = process.argv.includes("--clear");
  const result = clearOnly ? await clearDemoData() : await seedDemoData();
  console.log(JSON.stringify({ action: clearOnly ? "已清除 A组演示数据" : "已创建 A组演示数据", ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
