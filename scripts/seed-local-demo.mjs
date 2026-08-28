import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";

// This script is deliberately local-only. It creates an isolated demo company
// and never clears any existing company, account, or customer data.
const databaseUrl = `file:${resolve(process.cwd(), "prisma/dev.db")}`;
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
  throw new Error("演示数据脚本只能连接本地 SQLite 数据库，已拒绝非本地数据库。");
}

const db = new PrismaClient({ datasourceUrl: databaseUrl });

const DEMO = {
  departmentId: "demo-department",
  groupId: "demo-group",
  channelId: "demo-channel",
  deviceId: "demo-device-wa-01",
  accounts: {
    admin: "demo-admin",
    resource: "demo-resource",
    company: "demo-company",
    lead: "demo-lead",
    reception: "demo-reception",
    operator: "demo-operator",
    expert: "demo-expert",
  },
};

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return formatDate(date);
}

const today = daysAgo(0);
const date = (days) => daysAgo(days);

const accounts = [
  { key: "admin", username: "demo_admin", name: "演示总公司管理员", password: "AdminDemo@56790", role: "ADMIN", groupId: null, departmentId: null },
  { key: "resource", username: "demo_resource", name: "演示资源部管理员", password: "ResourceDemo@56790", role: "RESOURCE_MANAGER", groupId: null, departmentId: null },
  { key: "company", username: "demo_company", name: "演示公司管理员", password: "CompanyDemo@56790", role: "COMPANY_MANAGER", groupId: null, departmentId: DEMO.departmentId },
  { key: "lead", username: "demo_lead", name: "演示组长", password: "LeadDemo@56790", role: "LEAD", groupId: DEMO.groupId, departmentId: null },
  { key: "reception", username: "demo_reception", name: "演示接粉", password: "ReceptionDemo@56790", role: "RECEPTION", groupId: DEMO.groupId, departmentId: null },
  { key: "operator", username: "demo_operator", name: "演示炒群", password: "OperatorDemo@56790", role: "GROUP_OPERATOR", groupId: DEMO.groupId, departmentId: null },
  { key: "expert", username: "demo_expert", name: "演示专家", password: "ExpertDemo@56790", role: "EXPERT", groupId: DEMO.groupId, departmentId: null },
];

async function clearOnlyDemoOperationalData(transaction) {
  const batches = await transaction.sourceBatch.findMany({
    where: { groupId: DEMO.groupId },
    select: { id: true },
  });
  const batchIds = batches.map((batch) => batch.id);

  if (batchIds.length) {
    await transaction.metricEvent.deleteMany({ where: { batchId: { in: batchIds } } });
    await transaction.leadException.deleteMany({ where: { batchId: { in: batchIds } } });
    await transaction.leadActivity.deleteMany({ where: { lead: { batchId: { in: batchIds } } } });
    await transaction.customerOrder.deleteMany({ where: { batchId: { in: batchIds } } });
    await transaction.leadCustomer.deleteMany({ where: { batchId: { in: batchIds } } });
    await transaction.sourceBatch.deleteMany({ where: { id: { in: batchIds } } });
  }

  await transaction.deviceAccount.deleteMany({ where: { groupId: DEMO.groupId } });
  await transaction.device.deleteMany({ where: { groupId: DEMO.groupId } });
  await transaction.channel.deleteMany({ where: { groupId: DEMO.groupId } });
}

async function main() {
  await db.$transaction(async (transaction) => {
    await transaction.department.upsert({
      where: { id: DEMO.departmentId },
      update: {
        name: "系统演示公司",
        active: true,
        countryCode: "US",
        timezone: "America/New_York",
        workStartMinutes: 600,
        workEndMinutes: 1320,
      },
      create: {
        id: DEMO.departmentId,
        name: "系统演示公司",
        active: true,
        countryCode: "US",
        timezone: "America/New_York",
        workStartMinutes: 600,
        workEndMinutes: 1320,
      },
    });

    await transaction.teamGroup.upsert({
      where: { id: DEMO.groupId },
      update: {
        name: "系统演示组",
        active: true,
        departmentId: DEMO.departmentId,
        countryCode: "US",
        timezone: "America/New_York",
        workStartMinutes: 600,
        workEndMinutes: 1320,
      },
      create: {
        id: DEMO.groupId,
        name: "系统演示组",
        active: true,
        departmentId: DEMO.departmentId,
        countryCode: "US",
        timezone: "America/New_York",
        workStartMinutes: 600,
        workEndMinutes: 1320,
      },
    });

    for (const account of accounts) {
      const id = DEMO.accounts[account.key];
      const data = {
        employeeCode: account.username,
        username: account.username,
        name: account.name,
        passwordHash: hashPassword(account.password),
        role: account.role,
        active: true,
        groupId: account.groupId,
        departmentId: account.departmentId,
        hireDate: date(30),
      };
      await transaction.user.upsert({ where: { id }, update: data, create: { id, ...data } });
      if (account.groupId) await transaction.userGroupMembership.upsert({ where: { userId_effectiveFrom: { userId: id, effectiveFrom: date(30) } }, update: { groupId: account.groupId, role: account.role, effectiveTo: null }, create: { userId: id, groupId: account.groupId, role: account.role, effectiveFrom: date(30), reason: "本地演示数据" } });
    }

    await transaction.session.deleteMany({ where: { userId: { in: Object.values(DEMO.accounts) } } });
    await transaction.groupOperatorReception.deleteMany({ where: { receptionistId: DEMO.accounts.reception } });
    await transaction.groupOperatorReception.upsert({
      where: { groupOperatorId_receptionistId: { groupOperatorId: DEMO.accounts.operator, receptionistId: DEMO.accounts.reception } },
      update: {},
      create: { groupOperatorId: DEMO.accounts.operator, receptionistId: DEMO.accounts.reception },
    });

    await clearOnlyDemoOperationalData(transaction);

    const device = await transaction.device.create({
      data: {
        id: DEMO.deviceId,
        groupId: DEMO.groupId,
        memberId: DEMO.accounts.reception,
        code: "演示 WA-01",
        active: true,
      },
    });
    await transaction.deviceAccount.create({
      data: {
        groupId: DEMO.groupId,
        ownerId: DEMO.accounts.reception,
        accountType: "NORMAL_WS",
        provider: "WhatsApp",
        accountNumber: "演示 WA-01",
        purpose: "接粉跟进演示",
        situation: "正常使用",
      },
    });

    await transaction.channel.create({
      data: {
        id: DEMO.channelId,
        groupId: DEMO.groupId,
        name: "演示投流渠道",
        normalizedName: "演示投流渠道",
        createdById: DEMO.accounts.resource,
        active: true,
        fanCostMode: "PAID",
        effectiveFanPriceCents: 3500,
      },
    });

    const batchDates = [date(16), date(10), date(7), date(4), date(1), today];
    const batchByDate = new Map();
    for (const [index, sourceDate] of batchDates.entries()) {
      const batch = await transaction.sourceBatch.create({
        data: {
          id: `demo-batch-${index}`,
          groupId: DEMO.groupId,
          channelId: DEMO.channelId,
          sourceDate,
          fanCostModeSnapshot: "PAID",
          effectiveFanPriceCentsSnapshot: 3500,
        },
      });
      batchByDate.set(sourceDate, batch.id);
    }

    const batch = (days) => batchByDate.get(date(days)) ?? batchByDate.get(today);
    const leads = [
      { id: "demo-customer-01", phone: "19980000001", batchId: batch(0), customerName: "待回复客户", replyStatus: "FOLLOW_UP", followUpCount: 2, lastFollowedUpOn: today, notes: "已两次回访，等待客户回复。" },
      { id: "demo-customer-02", phone: "19980000002", batchId: batch(1), customerName: "已回复待入群", replyStatus: "REPLIED", repliedOn: today, followUpCount: 1, lastFollowedUpOn: today, lossAmountCents: 120000, notes: "客户已回复，今晚安排入群。" },
      { id: "demo-customer-03", phone: "19980000003", batchId: batch(1), customerName: "入群第 1 天", replyStatus: "REPLIED", repliedOn: date(1), groupStatus: "JOINED", joinedOn: today, notes: "刚入群，观察互动情况。" },
      { id: "demo-customer-04", phone: "19980000004", batchId: batch(4), customerName: "入群第 4 天", replyStatus: "REPLIED", repliedOn: date(5), groupStatus: "JOINED", joinedOn: date(3), notes: "已完成群内互动，今天可准备推专家。" },
      { id: "demo-customer-05", phone: "19980000005", batchId: batch(7), customerName: "待联系专家", replyStatus: "REPLIED", repliedOn: date(8), groupStatus: "JOINED", joinedOn: date(6), expertIntroducedOn: date(1), notes: "已推专家，等待客户主动联系。" },
      { id: "demo-customer-06", phone: "19980000006", batchId: batch(7), customerName: "专家跟进中", replyStatus: "REPLIED", repliedOn: date(9), groupStatus: "JOINED", joinedOn: date(7), expertIntroducedOn: date(3), expertContactedOn: date(2), expertContactNote: "已联系，客户周末准备注册。", nextPlan: "周一提醒客户完成注册", nextFollowUpOn: date(1), notes: "专家正在跟进注册。" },
      { id: "demo-customer-07", phone: "19980000007", batchId: batch(10), customerName: "已注册待开单", replyStatus: "REPLIED", repliedOn: date(11), groupStatus: "JOINED", joinedOn: date(9), expertIntroducedOn: date(6), expertContactedOn: date(5), expertContactNote: "客户已联系专家。", registeredOn: date(2), nextPlan: "确认首充时间", nextFollowUpOn: today, notes: "已注册，等待首充。" },
      { id: "demo-customer-08", phone: "19980000008", batchId: batch(16), customerName: "已开单客户", replyStatus: "REPLIED", repliedOn: date(15), groupStatus: "JOINED", joinedOn: date(13), expertIntroducedOn: date(10), expertContactedOn: date(9), expertContactNote: "已完成开户指导。", registeredOn: date(8), nextPlan: "维护关系并争取续充", nextFollowUpOn: date(2), notes: "已开单，有后续续充空间。" },
      { id: "demo-customer-09", phone: "19980000009", batchId: batch(10), customerName: "提前退群客户", replyStatus: "REPLIED", repliedOn: date(10), groupStatus: "LEFT", joinedOn: date(8), leftOn: date(4), leftWithOrder: false, notes: "第 5 天退群，未开单，需要复盘。" },
      { id: "demo-customer-10", phone: "19980000010", batchId: batch(16), customerName: "正常退群已开单", replyStatus: "REPLIED", repliedOn: date(16), groupStatus: "LEFT", joinedOn: date(15), expertIntroducedOn: date(12), expertContactedOn: date(11), registeredOn: date(10), leftOn: today, leftWithOrder: true, notes: "满 15 天后退群，已开单，属于正常完成。" },
      { id: "demo-customer-11", phone: "19980000011", batchId: batch(0), customerName: "无效粉示例", invalid: true, invalidReason: "号码为空号", replyStatus: "NOT_REPLIED", notes: "无效粉，不进入后续流程。" },
      { id: "demo-customer-12", phone: "19980000012", batchId: batch(4), customerName: "专家待跟进", replyStatus: "REPLIED", repliedOn: date(4), groupStatus: "JOINED", joinedOn: date(3), expertIntroducedOn: today, notes: "今日刚推专家，尚未联系。" },
      { id: "demo-customer-13", phone: "19980000013", batchId: batch(4), customerName: "等待多天未回复", replyStatus: "NOT_REPLIED", notes: "演示：来源日期较早、一直没回复的号码，用于验证等待天数提示。" },
    ];

    for (const lead of leads) {
      await transaction.leadCustomer.create({
        data: {
          ...lead,
          ownerId: DEMO.accounts.reception,
          deviceId: device.id,
          groupOperatorOwnerId: lead.groupStatus === "JOINED" || lead.groupStatus === "LEFT" ? DEMO.accounts.operator : null,
          expertOwnerId: lead.expertIntroducedOn ? DEMO.accounts.expert : null,
        },
      });
    }

    const addActivity = (leadId, actorId, kind, occurredOn, note) => transaction.leadActivity.create({
      data: { leadId, actorId, kind, occurredOn, note },
    });
    await addActivity("demo-customer-01", DEMO.accounts.reception, "FOLLOWED_UP", date(1), "第 2 次回访，暂未回复");
    await addActivity("demo-customer-01", DEMO.accounts.reception, "FOLLOWED_UP", today, "第 3 次回访，等待回复");
    await addActivity("demo-customer-02", DEMO.accounts.reception, "REPLIED", today, "客户已真实回复");
    for (const lead of leads.filter((item) => item.groupStatus === "JOINED" || item.groupStatus === "LEFT")) {
      await addActivity(lead.id, DEMO.accounts.reception, "JOINED_GROUP", lead.joinedOn, "客户已入群");
    }
    await addActivity("demo-customer-03", DEMO.accounts.operator, "GROUP_PROGRESS_UPDATED", today, "第 1 天：已欢迎入群，客户正在浏览群内容。");
    await addActivity("demo-customer-04", DEMO.accounts.operator, "GROUP_PROGRESS_UPDATED", today, "第 4 天：参与互动积极，建议今天介绍专家。");
    await addActivity("demo-customer-05", DEMO.accounts.operator, "EXPERT_INTRODUCED", date(1), "已介绍专家，等待客户联系。");
    await addActivity("demo-customer-06", DEMO.accounts.operator, "EXPERT_INTRODUCED", date(3), "已介绍专家并分配负责人。");
    await addActivity("demo-customer-06", DEMO.accounts.expert, "EXPERT_CONTACTED", date(2), "客户已联系专家，周末准备注册。");
    await addActivity("demo-customer-06", DEMO.accounts.expert, "PLAN_UPDATED", today, "今日进度：已确认需求；下一步周一提醒完成注册。");
    await addActivity("demo-customer-07", DEMO.accounts.operator, "EXPERT_INTRODUCED", date(6), "已介绍专家。");
    await addActivity("demo-customer-07", DEMO.accounts.expert, "EXPERT_CONTACTED", date(5), "专家已联系客户。");
    await addActivity("demo-customer-07", DEMO.accounts.expert, "REGISTERED", date(2), "客户已注册，等待首充。");
    await addActivity("demo-customer-07", DEMO.accounts.expert, "PLAN_UPDATED", today, "今日进度：客户已注册；下一步确认首充时间。");
    await addActivity("demo-customer-08", DEMO.accounts.operator, "EXPERT_INTRODUCED", date(10), "已介绍专家。");
    await addActivity("demo-customer-08", DEMO.accounts.expert, "EXPERT_CONTACTED", date(9), "专家已联系客户。");
    await addActivity("demo-customer-08", DEMO.accounts.expert, "REGISTERED", date(8), "客户已注册。");
    await addActivity("demo-customer-08", DEMO.accounts.expert, "PLAN_UPDATED", today, "今日进度：首充已完成，下一步维护关系并争取续充。");
    await addActivity("demo-customer-09", DEMO.accounts.operator, "LEFT_GROUP", date(4), "第 5 天退群，未开单，需复盘原因。");
    await addActivity("demo-customer-10", DEMO.accounts.operator, "LEFT_GROUP", today, "满 15 天后正常退群，已完成开单。");
    await addActivity("demo-customer-12", DEMO.accounts.operator, "EXPERT_INTRODUCED", today, "今日推专家，待联系。");

    const orders = [
      { id: "demo-order-01", leadId: "demo-customer-08", phone: "19980000008", batchId: batch(16), openedOn: date(6), initialDepositCents: 30000 },
      { id: "demo-order-02", leadId: "demo-customer-10", phone: "19980000010", batchId: batch(16), openedOn: date(9), initialDepositCents: 20000 },
    ];
    for (const order of orders) {
      await transaction.customerOrder.create({ data: { ...order, enteredById: DEMO.accounts.expert } });
      await transaction.metricEvent.create({
        data: { batchId: order.batchId, enteredById: DEMO.accounts.expert, occurredOn: order.openedOn, kind: "ORDER", amountCents: order.initialDepositCents, customerOrderId: order.id, continuationNumber: 0, derivedFromLedger: true },
      });
    }
    await transaction.metricEvent.createMany({
      data: [
        { batchId: batch(16), enteredById: DEMO.accounts.expert, occurredOn: date(3), kind: "RECHARGE", amountCents: 12000, customerOrderId: "demo-order-01", continuationNumber: 1, derivedFromLedger: true },
        { batchId: batch(16), enteredById: DEMO.accounts.expert, occurredOn: date(2), kind: "WITHDRAWAL", amountCents: 5000, customerOrderId: "demo-order-01", continuationNumber: 2, derivedFromLedger: true },
        { batchId: batch(0), enteredById: DEMO.accounts.reception, occurredOn: today, kind: "NEW_FANS", quantity: 2 },
        { batchId: batch(1), enteredById: DEMO.accounts.reception, occurredOn: today, kind: "REPLIES", quantity: 1 },
        { batchId: batch(4), enteredById: DEMO.accounts.operator, occurredOn: today, kind: "EXPERT_INTRO", quantity: 1 },
      ],
    });
  });

  const summary = await db.leadCustomer.groupBy({
    by: ["groupStatus"],
    where: { batch: { groupId: DEMO.groupId } },
    _count: { _all: true },
  });
  console.log(`本地演示数据已准备完成：${today}，系统演示公司 / 系统演示组。`);
  console.log(`客户状态：${summary.map((item) => `${item.groupStatus} ${item._count._all}`).join("；")}`);
  console.log("演示账号已创建：demo_reception、demo_operator、demo_expert、demo_lead（以及 demo_company、demo_resource、demo_admin）。");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
