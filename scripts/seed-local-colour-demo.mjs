import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

// 仅为本地 A 组补一小批颜色演示数据；不会删除其他客户或任何正式数据库。
const databaseUrl = process.env.LOCAL_DEMO_DATABASE_URL ?? `file:${resolve(process.cwd(), "prisma/dev.db")}`;
if (!databaseUrl.startsWith("file:")) {
  throw new Error("颜色演示数据只能写入本地 SQLite 数据库。");
}

const db = new PrismaClient({ datasourceUrl: databaseUrl });
const DEMO = {
  groupId: "group-a",
  channelId: "local-colour-demo-channel",
  batchId: "local-colour-demo-batch-20260818",
  receptionId: "initial-reception",
  operatorId: "initial-operator",
  expertId: "initial-expert",
  date: "2026-08-18",
};

const lead = (suffix, data) => ({
  id: `local-colour-demo-${suffix}`,
  phone: `17770010${suffix}`,
  batchId: DEMO.batchId,
  ownerId: DEMO.receptionId,
  receptionCategory: "VALID",
  replyStatus: "REPLIED",
  repliedOn: DEMO.date,
  ...data,
});

async function clearPreviousDemo(transaction) {
  await transaction.metricEvent.deleteMany({ where: { batchId: DEMO.batchId } });
  await transaction.customerOrder.deleteMany({ where: { batchId: DEMO.batchId } });
  await transaction.leadActivity.deleteMany({ where: { lead: { batchId: DEMO.batchId } } });
  await transaction.leadCustomer.deleteMany({ where: { batchId: DEMO.batchId } });
  await transaction.sourceBatch.deleteMany({ where: { id: DEMO.batchId } });
}

async function main() {
  await db.$transaction(async (transaction) => {
    await clearPreviousDemo(transaction);
    await transaction.channel.upsert({
      where: { id_groupId: { id: DEMO.channelId, groupId: DEMO.groupId } },
      create: {
        id: DEMO.channelId,
        groupId: DEMO.groupId,
        name: "颜色状态演示渠道",
        normalizedName: "颜色状态演示渠道",
        createdById: "initial-admin",
        active: true,
      },
      update: { active: true },
    });
    await transaction.sourceBatch.create({
      data: {
        id: DEMO.batchId,
        groupId: DEMO.groupId,
        channelId: DEMO.channelId,
        sourceDate: DEMO.date,
      },
    });

    const leads = [
      lead("01", { customerName: "在群待推专家", groupStatus: "JOINED", joinedOn: "2026-08-16", groupOperatorOwnerId: DEMO.operatorId, notes: "群内互动正常，等待第 3 天推专家。" }),
      lead("02", { customerName: "已推专家待联系", groupStatus: "JOINED", joinedOn: "2026-08-14", groupOperatorOwnerId: DEMO.operatorId, expertOwnerId: DEMO.expertId, expertIntroducedOn: "2026-08-17", notes: "已介绍专家，等待客户主动联系。" }),
      lead("03", { customerName: "专家已联系待注册", groupStatus: "JOINED", joinedOn: "2026-08-12", groupOperatorOwnerId: DEMO.operatorId, expertOwnerId: DEMO.expertId, expertIntroducedOn: "2026-08-15", expertContactedOn: "2026-08-16", expertContactNote: "客户说明天注册", expertNotes: "已说明开户流程，约明天确认注册结果。", notes: "客户公共备注：重点关注注册时间。" }),
      lead("04", { customerName: "已注册待开单", groupStatus: "JOINED", joinedOn: "2026-08-10", groupOperatorOwnerId: DEMO.operatorId, expertOwnerId: DEMO.expertId, expertIntroducedOn: "2026-08-13", expertContactedOn: "2026-08-14", registeredOn: "2026-08-16", expertNotes: "已注册，今天提醒客户完成首充。", notes: "客户公共备注：已完成注册。" }),
      lead("05", { customerName: "不首充示例", groupStatus: "JOINED", joinedOn: "2026-08-10", groupOperatorOwnerId: DEMO.operatorId, expertOwnerId: DEMO.expertId, expertIntroducedOn: "2026-08-13", expertContactedOn: "2026-08-14", registeredOn: "2026-08-16", noInitialDepositOn: DEMO.date, noInitialDepositReason: "NO_BUDGET", noInitialDepositNote: "暂时没有可用资金，下月再联系。" }),
      lead("06", { customerName: "已开单有续充", groupStatus: "JOINED", joinedOn: "2026-08-07", groupOperatorOwnerId: DEMO.operatorId, expertOwnerId: DEMO.expertId, expertIntroducedOn: "2026-08-10", expertContactedOn: "2026-08-11", registeredOn: "2026-08-12", expertNotes: "首充后已完成一次续充，持续维护关系并争取下一次续充。", notes: "客户公共备注：已开单。" }),
      lead("07", { customerName: "杀不动示例", groupStatus: "JOINED", joinedOn: "2026-08-06", groupOperatorOwnerId: DEMO.operatorId, expertOwnerId: DEMO.expertId, expertIntroducedOn: "2026-08-09", expertContactedOn: "2026-08-10", registeredOn: "2026-08-11", expertStalledOn: DEMO.date, expertStalledReason: "NO_RESPONSE", expertStalledNote: "开单后连续两周未回复。", expertNotes: "已多次联系未回复，暂时标记为杀不动。" }),
      lead("08", { customerName: "已退群客户", groupStatus: "LEFT", joinedOn: "2026-08-09", leftOn: "2026-08-13", leftWithOrder: false, groupOperatorOwnerId: DEMO.operatorId, notes: "第 5 天退群，仍保留后续推专家机会。" }),
      lead("09", { customerName: "已回复待入群", groupStatus: "NOT_JOINED", notes: "已回复，等待确认进群。" }),
      lead("10", { customerName: "低金额数据", groupStatus: "NOT_JOINED", receptionCategory: "LOW_AMOUNT", lossAmountCents: 320000, notes: "金额低于 5000，仍可继续跟进。" }),
      lead("11", { customerName: "无 WS 号码", groupStatus: "NOT_JOINED", receptionCategory: "NO_WS", notes: "客户没有 WhatsApp，可转短信继续联系。" }),
      lead("12", { customerName: "无效数据", groupStatus: "NOT_JOINED", receptionCategory: "INVALID", invalid: true, invalidReason: "号码为空号", replyStatus: "NOT_REPLIED", repliedOn: null, notes: "无效数据示例。" }),
    ];
    await transaction.leadCustomer.createMany({ data: leads });

    const addActivity = (leadId, actorId, kind, note) => transaction.leadActivity.create({
      data: { leadId, actorId, kind, occurredOn: DEMO.date, note },
    });
    await Promise.all([
      addActivity("local-colour-demo-01", DEMO.operatorId, "GROUP_PROGRESS_UPDATED", "在群互动正常，等待推专家。"),
      addActivity("local-colour-demo-02", DEMO.operatorId, "EXPERT_INTRODUCED", "已介绍专家，待联系。"),
      addActivity("local-colour-demo-03", DEMO.expertId, "EXPERT_CONTACTED", "客户已联系专家，待注册。"),
      addActivity("local-colour-demo-04", DEMO.expertId, "REGISTERED", "客户已注册，待开单。"),
      addActivity("local-colour-demo-05", DEMO.expertId, "PLAN_UPDATED", "客户暂不首充：暂时没有可用资金。"),
      addActivity("local-colour-demo-03", DEMO.operatorId, "GROUP_PROGRESS_UPDATED", "群内已完成需求沟通，客户认可后交接专家。"),
      addActivity("local-colour-demo-04", DEMO.operatorId, "GROUP_PROGRESS_UPDATED", "群内互动完成，已顺利交接专家推进首充。"),
      addActivity("local-colour-demo-05", DEMO.operatorId, "GROUP_PROGRESS_UPDATED", "群内已稳定互动，专家正在继续确认首充意愿。"),
      addActivity("local-colour-demo-06", DEMO.expertId, "REGISTERED", "客户已注册并完成开单。"),
      addActivity("local-colour-demo-07", DEMO.expertId, "PLAN_UPDATED", "开单后暂时杀不动，等待后续唤醒。"),
      addActivity("local-colour-demo-06", DEMO.operatorId, "GROUP_PROGRESS_UPDATED", "群内已完成交接，客户互动稳定后推给专家。"),
      addActivity("local-colour-demo-07", DEMO.operatorId, "GROUP_PROGRESS_UPDATED", "群内完成需求沟通，已交接专家继续跟进。"),
      addActivity("local-colour-demo-08", DEMO.operatorId, "LEFT_GROUP", "客户已退群，保留后续跟进。"),
      addActivity("local-colour-demo-09", DEMO.receptionId, "REPLIED", "客户已回复，等待确认进群。"),
    ]);

    const orders = [
      { id: "local-colour-demo-order-06", leadId: "local-colour-demo-06", phone: "1777001006", openedOn: "2026-08-15", initialDepositCents: 300000 },
      { id: "local-colour-demo-order-07", leadId: "local-colour-demo-07", phone: "1777001007", openedOn: "2026-08-14", initialDepositCents: 150000 },
    ];
    for (const order of orders) {
      await transaction.customerOrder.create({ data: { ...order, batchId: DEMO.batchId, enteredById: DEMO.expertId } });
    }
    await transaction.metricEvent.createMany({
      data: [
        { batchId: DEMO.batchId, enteredById: DEMO.expertId, occurredOn: "2026-08-15", kind: "ORDER", quantity: 1, customerOrderId: "local-colour-demo-order-06", derivedFromLedger: true },
        { batchId: DEMO.batchId, enteredById: DEMO.expertId, occurredOn: "2026-08-15", kind: "RECHARGE", amountCents: 300000, customerOrderId: "local-colour-demo-order-06", derivedFromLedger: true },
        { batchId: DEMO.batchId, enteredById: DEMO.expertId, occurredOn: "2026-08-18", kind: "RECHARGE", amountCents: 100000, customerOrderId: "local-colour-demo-order-06", continuationNumber: 1, derivedFromLedger: true },
        { batchId: DEMO.batchId, enteredById: DEMO.expertId, occurredOn: "2026-08-14", kind: "ORDER", quantity: 1, customerOrderId: "local-colour-demo-order-07", derivedFromLedger: true },
        { batchId: DEMO.batchId, enteredById: DEMO.expertId, occurredOn: "2026-08-14", kind: "RECHARGE", amountCents: 150000, customerOrderId: "local-colour-demo-order-07", derivedFromLedger: true },
      ],
    });
  });
  console.log("已在本地 A 组加入 12 个颜色演示客户；重复运行会只替换这批演示数据。");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
