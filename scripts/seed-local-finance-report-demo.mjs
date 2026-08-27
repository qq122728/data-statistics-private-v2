import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

// 只用于本地核对渠道和组员业绩报表，不会连接服务器数据库。
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
  throw new Error("财务核对演示只能写入本地 SQLite 数据库。");
}

const db = new PrismaClient({ datasourceUrl: `file:${resolve(process.cwd(), "prisma/dev.db")}` });
const groupId = "group-a";
const sourceDates = Array.from({ length: 18 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
const prefix = "财务核对演示-";

const channels = [
  { id: "finance-demo-sms", name: `${prefix}短信`, type: "SMS", fanCostMode: "PAID", price: 3_500, rebateRateBps: null, advertisingSpendCents: null },
  { id: "finance-demo-ads", name: `${prefix}投流`, type: "ADS", fanCostMode: "PAID", price: 1_917, rebateRateBps: null, advertisingSpendCents: 30_000 },
  { id: "finance-demo-rebate", name: `${prefix}底料返点`, type: "REBATE", fanCostMode: "FREE", price: 0, rebateRateBps: 3_000, advertisingSpendCents: null },
];

const receptionIds = ["initial-reception", "a-reception_b", "a-reception_c", "a-reception_d", "a-reception_e", "a-reception_f"];
const operatorIds = ["initial-operator", "a-operator_b"];
const expertIds = ["initial-expert", "initial-lead"];

async function clearPreviousDemo(tx) {
  const batches = await tx.sourceBatch.findMany({ where: { channel: { groupId, name: { startsWith: prefix } } }, select: { id: true } });
  const batchIds = batches.map((batch) => batch.id);
  const leads = batchIds.length ? await tx.leadCustomer.findMany({ where: { batchId: { in: batchIds } }, select: { id: true } }) : [];
  const leadIds = leads.map((lead) => lead.id);
  const orders = leadIds.length ? await tx.customerOrder.findMany({ where: { leadId: { in: leadIds } }, select: { id: true } }) : [];
  await tx.metricEvent.deleteMany({ where: { OR: [{ batchId: { in: batchIds } }, { customerOrderId: { in: orders.map((order) => order.id) } }] } });
  await tx.customerOrder.deleteMany({ where: { id: { in: orders.map((order) => order.id) } } });
  await tx.leadActivity.deleteMany({ where: { leadId: { in: leadIds } } });
  await tx.leadCustomer.deleteMany({ where: { id: { in: leadIds } } });
  await tx.sourceBatch.deleteMany({ where: { id: { in: batchIds } } });
  await tx.channel.deleteMany({ where: { groupId, name: { startsWith: prefix } } });
}

function codeFor(channel, dayIndex, index) {
  const head = channel.type === "ADS" ? "TL" : channel.type === "REBATE" ? "DL" : "JH";
  return `${head}-${channel.name.replaceAll("-", "")}-${String(dayIndex * 10 + index + 1).padStart(6, "0")}`;
}

async function main() {
  const people = await db.user.findMany({ where: { id: { in: [...receptionIds, ...operatorIds, ...expertIds] }, active: true }, select: { id: true } });
  if (people.length !== 10) throw new Error("A 组的 6 接粉、2 炒群、专家和组长账号不完整，无法生成核对数据。");

  await db.$transaction(async (tx) => {
    await clearPreviousDemo(tx);
    for (const channel of channels) {
      await tx.channel.create({
        data: {
          id: channel.id, groupId, name: channel.name, normalizedName: channel.name.toLowerCase(), createdById: "initial-admin",
          channelType: channel.type, fanCostMode: channel.fanCostMode, effectiveFanPriceCents: channel.price || null, rebateRateBps: channel.rebateRateBps,
        },
      });
    }

    for (const [dayIndex, sourceDate] of sourceDates.entries()) {
      for (const [channelIndex, channel] of channels.entries()) {
        const batchId = `${channel.id}-batch-${sourceDate}`;
        await tx.sourceBatch.create({
          data: {
            id: batchId, groupId, channelId: channel.id, sourceDate,
            channelTypeSnapshot: channel.type, fanCostModeSnapshot: channel.fanCostMode, effectiveFanPriceCentsSnapshot: channel.price || null,
            rebateRateBpsSnapshot: channel.rebateRateBps,
            // 投流广告费按每天导入的号码分摊，避免把整月广告费重复算 18 次。
            advertisingSpendCents: channel.type === "ADS" ? Math.round((channel.advertisingSpendCents ?? 0) / sourceDates.length) : null,
            advertisingServiceFeeRateBps: channel.type === "ADS" ? 1_500 : null,
          },
        });
        for (let index = 0; index < 8; index += 1) {
        const stage = index;
        const ownerId = receptionIds[index % receptionIds.length];
        const operatorId = operatorIds[index % operatorIds.length];
        const expertId = expertIds[index % expertIds.length];
        const replied = stage < (channelIndex === 1 ? 4 : channelIndex === 2 ? 6 : 5);
        const joined = stage < (channelIndex === 1 ? 3 : channelIndex === 2 ? 5 : 4);
        const introduced = stage < (channelIndex === 1 ? 2 : channelIndex === 2 ? 4 : 3);
        const contacted = stage < (channelIndex === 1 ? 1 : channelIndex === 2 ? 3 : 2);
        const registered = stage < (channelIndex === 1 ? 1 : channelIndex === 2 ? 2 : 1);
        const orders = stage < (channelIndex === 1 ? 1 : channelIndex === 2 ? 2 : 1);
        const invalidCategory = stage === 6 ? "LOW_AMOUNT" : stage === 7 ? "NO_WS" : "VALID";
        const leadId = `${channel.id}-lead-${sourceDate}-${index + 1}`;
        const phone = codeFor(channel, dayIndex, index);
        await tx.leadCustomer.create({
          data: {
            id: leadId, phone, batchId, ownerId, groupOperatorOwnerId: joined ? operatorId : null, expertOwnerId: introduced ? expertId : null,
            customerName: `${channel.name}客户 ${String(index + 1).padStart(2, "0")}`,
            receptionCategory: invalidCategory, invalidReason: invalidCategory === "LOW_AMOUNT" ? "核对数据：低金额" : invalidCategory === "NO_WS" ? "核对数据：无 WS" : null,
            lossAmountCents: invalidCategory === "LOW_AMOUNT" ? 320_000 : null,
            replyStatus: replied ? "REPLIED" : "NOT_REPLIED", repliedOn: replied ? sourceDate : null,
            groupStatus: joined ? "JOINED" : "NOT_JOINED", joinedOn: joined ? sourceDate : null,
            expertIntroducedOn: introduced ? sourceDate : null, expertContactedOn: contacted ? sourceDate : null,
            expertContactNote: contacted ? "核对数据：专家已联系，继续推进注册。" : null,
            registeredOn: registered ? sourceDate : null,
            notes: `财务核对演示：${channel.type} 渠道，用于核对组员和渠道业绩。`,
          },
        });
        if (replied) await tx.leadActivity.create({ data: { leadId, actorId: ownerId, kind: "REPLIED", occurredOn: sourceDate, note: "核对数据：已回复" } });
        if (joined) await tx.leadActivity.create({ data: { leadId, actorId: ownerId, kind: "JOINED_GROUP", occurredOn: sourceDate, note: "核对数据：已进群" } });
        if (introduced) await tx.leadActivity.create({ data: { leadId, actorId: operatorId, kind: "EXPERT_INTRODUCED", occurredOn: sourceDate, note: "核对数据：已推专家" } });
        if (contacted) await tx.leadActivity.create({ data: { leadId, actorId: expertId, kind: "EXPERT_CONTACTED", occurredOn: sourceDate, note: "核对数据：已联系" } });
        if (registered) await tx.leadActivity.create({ data: { leadId, actorId: expertId, kind: "REGISTERED", occurredOn: sourceDate, note: "核对数据：已注册" } });
        if (!orders) continue;
        const deposits = channelIndex === 0 ? [200_000] : channelIndex === 1 ? [120_000] : [500_000, 200_000];
        const orderId = `${leadId}-order`;
        await tx.customerOrder.create({ data: { id: orderId, leadId, phone, batchId, enteredById: expertId, openedOn: sourceDate, initialDepositCents: deposits[index] } });
        await tx.metricEvent.create({ data: { batchId, enteredById: expertId, occurredOn: sourceDate, kind: "ORDER", quantity: 1, customerOrderId: orderId, continuationNumber: 0, derivedFromLedger: true } });
        if (index === 0 && dayIndex % 4 === 0) {
          const recharge = channelIndex === 2 ? 25_000 : channelIndex === 1 ? 40_000 : 50_000;
          await tx.metricEvent.create({ data: { batchId, enteredById: expertId, occurredOn: sourceDate, kind: "RECHARGE", amountCents: recharge, customerOrderId: orderId, continuationNumber: 1, derivedFromLedger: true } });
        }
        if (index === 0 && dayIndex % 6 === 0) {
          const withdrawal = channelIndex === 2 ? 75_000 : channelIndex === 1 ? 50_000 : 30_000;
          await tx.metricEvent.create({ data: { batchId, enteredById: expertId, occurredOn: sourceDate, kind: "WITHDRAWAL", amountCents: withdrawal, customerOrderId: orderId, continuationNumber: 2, derivedFromLedger: true } });
        }
        }
      }
    }
  });

  console.log("已建立 A 组 2026-08-01 至 2026-08-18 的模拟数据：短信、投流、底料返点 3 条渠道，每天都有不同漏斗与业绩。");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
