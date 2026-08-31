import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// 只补本机管理端报表所需的组织、人员和每日统计演示数据。
// 不连接服务器数据库，也不删除非 report-demo 前缀的数据。
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
  throw new Error("报表演示数据只能写入本地 SQLite 数据库。");
}

const db = new PrismaClient({ datasourceUrl: `file:${resolve(process.cwd(), "prisma/dev.db")}` });
const PASSWORD = "ReportDemo@56790";
const BASE_DATE = "2026-08-01";

const companies = [
  { id: "demo-company-org", name: "演示公司A" },
  { id: "report-demo-company-b", name: "演示公司B" },
];

const departments = [
  { id: "demo-department", name: "美国部", companyId: "demo-company-org", countryCode: "US", timezone: "America/New_York" },
  { id: "report-demo-department-de", name: "德国部", companyId: "demo-company-org", countryCode: "DE", timezone: "Europe/Berlin" },
  { id: "report-demo-department-uk", name: "英国部", companyId: "report-demo-company-b", countryCode: "GB", timezone: "Europe/London" },
];

const groups = [
  { id: "demo-group", name: "雄鹰一组", departmentId: "demo-department", countryCode: "US", timezone: "America/New_York", channelId: "demo-channel", channelName: "FB-M" },
  { id: "report-demo-group-us-2", name: "远航二组", departmentId: "demo-department", countryCode: "US", timezone: "America/New_York", channelId: "report-demo-channel-us-2", channelName: "FB-Q" },
  { id: "report-demo-group-us-3", name: "星河三组", departmentId: "demo-department", countryCode: "US", timezone: "America/New_York", channelId: "report-demo-channel-us-3", channelName: "短信粉嘉豪" },
  { id: "report-demo-group-us-4", name: "先锋四组", departmentId: "demo-department", countryCode: "US", timezone: "America/New_York", channelId: "report-demo-channel-us-4", channelName: "德国投流 B" },
  { id: "report-demo-group-de-1", name: "德国一组", departmentId: "report-demo-department-de", countryCode: "DE", timezone: "Europe/Berlin", channelId: "report-demo-channel-de-1", channelName: "演示短信A" },
  { id: "report-demo-group-uk-1", name: "英国一组", departmentId: "report-demo-department-uk", countryCode: "GB", timezone: "Europe/London", channelId: "report-demo-channel-uk-1", channelName: "演示投流C" },
];

// 美国部的每个小组都同时接多个渠道，用于真实验证“选小组后比较该组各渠道”。
const usChannelNames = ["FB-M", "FB-Q", "短信粉嘉豪", "德国投流 B"];
function channelsFor(group) {
  if (group.departmentId !== "demo-department") {
    return [{ id: group.channelId, name: group.channelName }];
  }
  return usChannelNames.map((name, index) => ({
    id: name === group.channelName ? group.channelId : `${group.id}-report-channel-${index + 1}`,
    name,
  }));
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function date(offset) {
  const value = new Date(Date.UTC(2026, 7, 30 - offset));
  return value.toISOString().slice(0, 10);
}

function peopleFor(group, index) {
  const prefix = `report-demo-${index + 1}`;
  const groupName = group.name;
  return {
    // 美国一组已经由基础演示数据创建了 demo_lead。这里必须复用，
    // 否则 SQLite 会出现两个在职组长，而 PostgreSQL 的正式约束会拒绝搬运。
    lead: group.id === "demo-group"
      ? { id: "demo-lead", username: "demo_lead", name: "演示组长", role: "LEAD", duty: "LEAD", existingUser: true }
      : { id: `${prefix}-lead`, username: `${prefix}-lead`, name: `${groupName}组长`, role: "LEAD", duty: "LEAD" },
    receptionA: { id: `${prefix}-reception-a`, username: `${prefix}-reception-a`, name: `${groupName}接粉甲`, role: "RECEPTION", duty: null },
    receptionB: { id: `${prefix}-reception-b`, username: `${prefix}-reception-b`, name: `${groupName}接粉乙`, role: "RECEPTION", duty: null },
    operatorA: { id: `${prefix}-operator-a`, username: `${prefix}-operator-a`, name: `${groupName}炒群甲`, role: "GROUP_OPERATOR", duty: null },
    operatorB: { id: `${prefix}-operator-b`, username: `${prefix}-operator-b`, name: `${groupName}炒群乙`, role: "GROUP_OPERATOR", duty: null },
    expert: { id: `${prefix}-expert`, username: `${prefix}-expert`, name: `${groupName}专家`, role: "EXPERT", duty: null },
  };
}

function identityKey({ ownerId, groupId, businessDate, position, channelId, sourceReceptionId = null, sourceGroupOperatorId = null }) {
  return JSON.stringify([ownerId, groupId, businessDate, position, channelId, sourceReceptionId, sourceGroupOperatorId]);
}

function receptionValues(groupIndex, channelIndex, personIndex, dayIndex) {
  const dispatchCount = 12 + groupIndex * 3 + channelIndex * 4 + personIndex * 2 + dayIndex;
  const duplicateCount = 1 + ((groupIndex + channelIndex + personIndex + dayIndex) % 3);
  const lowAmountCount = (groupIndex + channelIndex + dayIndex) % 3;
  const noWsCount = (channelIndex + personIndex + dayIndex) % 2;
  const manualInvalidCount = (groupIndex + channelIndex + personIndex + dayIndex) % 2;
  const effectiveCount = dispatchCount - duplicateCount - lowAmountCount - noWsCount - manualInvalidCount;
  return {
    dispatchCount, duplicateCount, lowAmountCount, noWsCount, manualInvalidCount, effectiveCount,
    replyCount: Math.max(1, Math.floor(effectiveCount * (0.32 + channelIndex * 0.035 + personIndex * 0.05))),
    joinCount: Math.max(1, Math.floor(effectiveCount * (0.17 + channelIndex * 0.02))),
  };
}

function operatorValues(groupIndex, channelIndex, personIndex, dayIndex) {
  const operatorReceivedCount = 7 + groupIndex + channelIndex * 2 + personIndex + dayIndex;
  const normalLeaveCount = (channelIndex + dayIndex + personIndex) % 3;
  const abnormalLeaveCount = (groupIndex + channelIndex + dayIndex) % 2;
  return {
    operatorReceivedCount,
    normalLeaveCount,
    abnormalLeaveCount,
    currentInGroupCount: 9 + groupIndex * 2 + channelIndex * 3 + personIndex * 3 + dayIndex,
    expertIntroCount: 2 + ((groupIndex + channelIndex + personIndex + dayIndex) % 4),
  };
}

function expertValues(groupIndex, channelIndex, personIndex, dayIndex) {
  const expertReceivedCount = 3 + ((groupIndex + channelIndex + personIndex + dayIndex) % 4);
  const expertContactedCount = Math.max(1, expertReceivedCount - 1);
  const registrationCount = Math.max(0, expertContactedCount - ((dayIndex + personIndex) % 2));
  const orderCount = Math.max(0, registrationCount - ((groupIndex + channelIndex + dayIndex) % 2));
  const cryptoInitialDepositCents = orderCount * (45_000 + groupIndex * 10_000 + channelIndex * 15_000 + personIndex * 5_000);
  return {
    expertReceivedCount,
    expertContactedCount,
    registrationCount,
    orderCount,
    cryptoInitialDepositCents,
    cryptoRechargeCents: dayIndex % 3 === 0 ? orderCount * 12_000 : 0,
    withdrawalCents: dayIndex % 4 === 0 ? orderCount * 5_000 : 0,
  };
}

async function removeOldReportingStats(tx) {
  const entries = await tx.dailyStatEntry.findMany({
    where: { id: { startsWith: "report-demo-entry-" } },
    select: { id: true },
  });
  const entryIds = entries.map((entry) => entry.id);
  if (!entryIds.length) return;
  await tx.dailyStatEntry.updateMany({ where: { id: { in: entryIds } }, data: { currentRevisionId: null, approvedRevisionId: null } });
  await tx.dailyStatRevision.deleteMany({ where: { entryId: { in: entryIds } } });
  await tx.dailyStatEntry.deleteMany({ where: { id: { in: entryIds } } });
}

async function removeOldCustomerProgressDemo(tx) {
  // 只按本脚本专用前缀清理，不能借 groupId/channelId 扩大范围，避免误删本机已有客户。
  await tx.customerFinanceEvent.deleteMany({ where: { id: { startsWith: "report-demo-" } } });
  await tx.metricEvent.deleteMany({ where: { id: { startsWith: "report-demo-customer-" } } });
  await tx.customerOrder.deleteMany({ where: { id: { startsWith: "report-demo-" } } });
  await tx.leadActivity.deleteMany({ where: { id: { startsWith: "report-demo-" } } });
  await tx.leadCustomer.deleteMany({ where: { id: { startsWith: "report-demo-" } } });
  await tx.sourceBatch.deleteMany({ where: { id: { startsWith: "report-demo-" } } });
  await tx.deviceAccount.deleteMany({ where: { id: { startsWith: "report-demo-" } } });
  await tx.device.deleteMany({ where: { id: { startsWith: "report-demo-" } } });
}

function customerProgressRows({ group, groupIndex, groupChannels, people, devices }) {
  const leads = [];
  const activities = [];
  const orders = [];
  const financeEvents = [];

  for (const [channelIndex, channel] of groupChannels.entries()) {
    const batchId = `report-demo-customer-batch-g${groupIndex + 1}-c${channelIndex + 1}`;

    // 每个渠道五位已进群客户：群内维护、推专家、注册、开单、退群各一位。
    // 四个渠道交替制造 1–8 天异常退群和 14 天起正常退群，页面可直接筛选验证。
    for (let stage = 0; stage < 5; stage += 1) {
      const serial = groupIndex * 100 + channelIndex * 10 + stage + 1;
      const id = `report-demo-customer-g${groupIndex + 1}-c${channelIndex + 1}-s${stage + 1}`;
      const phone = `170${groupIndex + 1}${channelIndex + 1}${String(serial).padStart(6, "0")}`;
      const reception = stage % 2 === 0 ? people.receptionA : people.receptionB;
      const operator = stage % 2 === 0 ? people.operatorA : people.operatorB;
      const expert = stage % 2 === 0 ? people.expert : people.lead;
      const joinedOn = stage === 4 && channelIndex % 2 === 1 ? "2026-08-10" : "2026-08-24";
      const introducedOn = "2026-08-27";
      const contactedOn = "2026-08-28";
      const registeredOn = "2026-08-29";
      const isLeft = stage === 4;
      const isExpert = stage >= 1 && stage <= 3;
      const isRegistered = stage >= 2 && stage <= 3;
      const isOrdered = stage === 3;
      const leftOn = isLeft ? "2026-08-28" : null;
      const leaveLabel = channelIndex % 2 === 0 ? "异常退群（入群第 5 天）" : "正常退群（入群第 19 天）";

      leads.push({
        id,
        phone,
        batchId,
        currentGroupId: group.id,
        ownerId: reception.id,
        attributionOwnerId: reception.id,
        deviceId: devices[stage % devices.length].id,
        groupOperatorOwnerId: operator.id,
        expertOwnerId: isExpert ? expert.id : null,
        customerName: `${group.name}-${channel.name}-客户${stage + 1}`,
        customerEmail: `report-demo-g${groupIndex + 1}-c${channelIndex + 1}-s${stage + 1}@example.test`,
        customerPlatform: stage % 2 === 0 ? "WhatsApp" : "RCS",
        receptionCategory: "VALID",
        invalid: false,
        replyStatus: "REPLIED",
        repliedOn: "2026-08-23",
        followUpCount: 2 + stage,
        lastFollowedUpOn: "2026-08-30",
        groupStatus: isLeft ? "LEFT" : "JOINED",
        joinedOn,
        leftOn,
        leftWithOrder: isLeft ? false : null,
        leftNote: isLeft ? `本地演示：${leaveLabel}` : null,
        expertIntroducedOn: isExpert ? introducedOn : null,
        expertContactedOn: isExpert ? contactedOn : null,
        expertContactNote: isExpert ? "本地演示：专家已沟通客户需求" : null,
        expertWorkflowStage: isOrdered ? "ORDERED" : isRegistered ? "PENDING_ORDER" : isExpert ? "TRACKING" : null,
        expertTrackingStartedAt: isExpert ? new Date("2026-08-28T12:00:00.000Z") : null,
        registeredOn: isRegistered ? registeredOn : null,
        nextPlan: isOrdered ? "跟进续充与出金安排" : isRegistered ? "提醒客户完成首充" : isExpert ? "继续跟进投资计划" : "保持群内互动并择机推专家",
        nextFollowUpOn: "2026-09-01",
        notes: `report-demo 本地客户进度；渠道：${channel.name}；设备：${devices[stage % devices.length].code}`,
      });

      const activityBase = `report-demo-activity-g${groupIndex + 1}-c${channelIndex + 1}-s${stage + 1}`;
      activities.push(
        { id: `${activityBase}-reply`, leadId: id, actorId: reception.id, kind: "REPLIED", occurredOn: "2026-08-23", note: "本地演示：客户已回复" },
        { id: `${activityBase}-join`, leadId: id, actorId: reception.id, kind: "JOINED_GROUP", occurredOn: joinedOn, note: "本地演示：客户已确认进群" },
      );
      if (stage === 0) activities.push({ id: `${activityBase}-maintain`, leadId: id, actorId: operator.id, kind: "GROUP_PROGRESS_UPDATED", occurredOn: "2026-08-30", note: "本地演示：群内互动正常，持续维护" });
      if (isExpert) activities.push(
        { id: `${activityBase}-intro`, leadId: id, actorId: operator.id, kind: "EXPERT_INTRODUCED", occurredOn: introducedOn, note: "本地演示：炒群负责人已推送专家" },
        { id: `${activityBase}-contact`, leadId: id, actorId: expert.id, kind: "EXPERT_CONTACTED", occurredOn: contactedOn, note: "本地演示：专家已联系客户" },
      );
      if (isRegistered) activities.push({ id: `${activityBase}-register`, leadId: id, actorId: expert.id, kind: "REGISTERED", occurredOn: registeredOn, note: "本地演示：客户已完成注册" });
      if (isLeft) activities.push({ id: `${activityBase}-leave`, leadId: id, actorId: operator.id, kind: "LEFT_GROUP", occurredOn: leftOn, note: `本地演示：${leaveLabel}` });

      if (isOrdered) {
        const orderId = `report-demo-order-g${groupIndex + 1}-c${channelIndex + 1}`;
        orders.push({
          id: orderId,
          phone,
          batchId,
          enteredById: expert.id,
          openedOn: "2026-08-30",
          initialDepositCents: 100_000 + groupIndex * 25_000 + channelIndex * 10_000,
          initialDepositMethod: channelIndex % 2 === 0 ? "CRYPTO" : "BANK",
          leadId: id,
        });
        financeEvents.push(
          { id: `${orderId}-recharge-1`, batchId, customerOrderId: orderId, enteredById: expert.id, occurredOn: "2026-08-30", kind: "RECHARGE", amountCents: 45_000, depositMethod: "CRYPTO", continuationNumber: 1 },
          { id: `${orderId}-recharge-2`, batchId, customerOrderId: orderId, enteredById: expert.id, occurredOn: "2026-08-31", kind: "RECHARGE", amountCents: 30_000, depositMethod: "BANK", continuationNumber: 2 },
          { id: `${orderId}-withdrawal`, batchId, customerOrderId: orderId, enteredById: expert.id, occurredOn: "2026-08-31", kind: "WITHDRAWAL", amountCents: 20_000 },
        );
      }
    }
  }

  return { leads, activities, orders, financeEvents };
}

async function createApprovedEntry(tx, { id, ownerId, groupId, channelId, businessDate, timezone, position, sourceReceptionId = null, sourceGroupOperatorId = null, values }) {
  const revisionId = `${id}-revision`;
  await tx.dailyStatEntry.create({
    data: {
      id,
      identityKey: identityKey({ ownerId, groupId, businessDate, position, channelId, sourceReceptionId, sourceGroupOperatorId }),
      ownerId,
      groupId,
      channelId,
      businessDate,
      timezone,
      position,
      sourceReceptionId,
      sourceGroupOperatorId,
      status: "APPROVED",
      submittedAt: new Date(`${businessDate}T12:00:00.000Z`),
      reviewedAt: new Date(`${businessDate}T13:00:00.000Z`),
    },
  });
  await tx.dailyStatRevision.create({
    data: { id: revisionId, entryId: id, version: 1, createdById: ownerId, changeReason: "本地报表演示数据", ...values },
  });
  await tx.dailyStatEntry.update({
    where: { id },
    data: { currentRevisionId: revisionId, approvedRevisionId: revisionId },
  });
}

async function main() {
  await db.$transaction(async (tx) => {
    await removeOldReportingStats(tx);
    await removeOldCustomerProgressDemo(tx);

    // 旧版报表演示脚本曾为美国一组额外创建 report-demo-1-lead。
    // 保留账号和历史引用，只退出当前在职口径，避免删除演示历史。
    await tx.user.updateMany({
      where: { id: "report-demo-1-lead", groupId: "demo-group", role: "LEAD" },
      data: { active: false },
    });

    for (const company of companies) {
      await tx.company.upsert({ where: { id: company.id }, update: { name: company.name, active: true }, create: { ...company, active: true } });
    }
    for (const department of departments) {
      await tx.department.upsert({
        where: { id: department.id },
        update: { ...department, active: true, workStartMinutes: 600, workEndMinutes: 1320 },
        create: { ...department, active: true, workStartMinutes: 600, workEndMinutes: 1320 },
      });
    }

    for (const [groupIndex, group] of groups.entries()) {
      await tx.teamGroup.upsert({
        where: { id: group.id },
        update: { name: group.name, departmentId: group.departmentId, countryCode: group.countryCode, timezone: group.timezone, active: true, workStartMinutes: 600, workEndMinutes: 1320 },
        create: { id: group.id, name: group.name, departmentId: group.departmentId, countryCode: group.countryCode, timezone: group.timezone, active: true, workStartMinutes: 600, workEndMinutes: 1320 },
      });
      const groupChannels = channelsFor(group);
      for (const channel of groupChannels) {
        await tx.channel.upsert({
          where: { id_groupId: { id: channel.id, groupId: group.id } },
          update: { name: channel.name, normalizedName: channel.name, channelType: channel.name.includes("短信") ? "SMS" : "ADS", active: true },
          create: { id: channel.id, groupId: group.id, name: channel.name, normalizedName: channel.name, channelType: channel.name.includes("短信") ? "SMS" : "ADS", active: true },
        });
      }

      const people = peopleFor(group, groupIndex);
      for (const person of Object.values(people)) {
        if (!person.existingUser) {
          await tx.user.upsert({
            where: { id: person.id },
            update: { employeeCode: person.username, username: person.username, name: person.name, passwordHash: hashPassword(PASSWORD), role: person.role, duty: person.duty, active: true, groupId: group.id, hireDate: BASE_DATE },
            create: { id: person.id, employeeCode: person.username, username: person.username, name: person.name, passwordHash: hashPassword(PASSWORD), role: person.role, duty: person.duty, active: true, groupId: group.id, hireDate: BASE_DATE },
          });
          await tx.userGroupMembership.upsert({
            where: { userId_effectiveFrom: { userId: person.id, effectiveFrom: BASE_DATE } },
            update: { groupId: group.id, role: person.role, effectiveTo: null, reason: "本地报表演示数据" },
            create: { userId: person.id, groupId: group.id, role: person.role, effectiveFrom: BASE_DATE, reason: "本地报表演示数据" },
          });
        }
      }
      await tx.userRoleAssignment.upsert({
        where: { userId_role: { userId: people.lead.id, role: "EXPERT" } },
        update: {},
        create: { userId: people.lead.id, role: "EXPERT" },
      });
      await tx.groupOperatorReception.upsert({ where: { receptionistId: people.receptionA.id }, update: { groupOperatorId: people.operatorA.id }, create: { groupOperatorId: people.operatorA.id, receptionistId: people.receptionA.id } });
      await tx.groupOperatorReception.upsert({ where: { receptionistId: people.receptionB.id }, update: { groupOperatorId: people.operatorB.id }, create: { groupOperatorId: people.operatorB.id, receptionistId: people.receptionB.id } });

      if (group.departmentId === "demo-department") {
        const devices = [people.receptionA, people.receptionB].map((person, deviceIndex) => ({
          id: `report-demo-device-g${groupIndex + 1}-${deviceIndex + 1}`,
          code: `report-demo-${groupIndex + 1}-device-${deviceIndex + 1}`,
          groupId: group.id,
          memberId: person.id,
          active: true,
        }));
        await tx.device.createMany({ data: devices });

        for (const [channelIndex, channel] of groupChannels.entries()) {
          await tx.sourceBatch.create({
            data: {
              id: `report-demo-customer-batch-g${groupIndex + 1}-c${channelIndex + 1}`,
              groupId: group.id,
              channelId: channel.id,
              sourceDate: "2026-08-31",
            },
          });
        }

        const customerRows = customerProgressRows({ group, groupIndex, groupChannels, people, devices });
        await tx.leadCustomer.createMany({ data: customerRows.leads });
        await tx.leadActivity.createMany({ data: customerRows.activities });
        for (const order of customerRows.orders) await tx.customerOrder.create({ data: order });
        await tx.customerFinanceEvent.createMany({ data: customerRows.financeEvents });
      }

      // 连续三周都准备数据，才能同时检查“每日明细、近7天、近30天、本月”四种视图。
      const days = Array.from({ length: 21 }, (_, offset) => offset);
      for (const [dayIndex, offset] of days.entries()) {
        const businessDate = date(offset);
        const receptions = [people.receptionA, people.receptionB];
        const operators = [people.operatorA, people.operatorB];
        const experts = [people.expert, people.lead];

        for (const [channelIndex, channel] of groupChannels.entries()) {
          for (const [personIndex, person] of receptions.entries()) {
            await createApprovedEntry(tx, {
              id: `report-demo-entry-${groupIndex}-c${channelIndex}-r${personIndex}-${businessDate}`,
              ownerId: person.id, groupId: group.id, channelId: channel.id, businessDate, timezone: group.timezone, position: "RECEPTION",
              values: receptionValues(groupIndex, channelIndex, personIndex, dayIndex),
            });
          }
          for (const [personIndex, person] of operators.entries()) {
            await createApprovedEntry(tx, {
              id: `report-demo-entry-${groupIndex}-c${channelIndex}-o${personIndex}-${businessDate}`,
              ownerId: person.id, groupId: group.id, channelId: channel.id, businessDate, timezone: group.timezone, position: "GROUP_OPERATOR",
              sourceReceptionId: receptions[personIndex].id,
              values: operatorValues(groupIndex, channelIndex, personIndex, dayIndex),
            });
          }
          for (const [personIndex, person] of experts.entries()) {
            await createApprovedEntry(tx, {
              id: `report-demo-entry-${groupIndex}-c${channelIndex}-e${personIndex}-${businessDate}`,
              ownerId: person.id, groupId: group.id, channelId: channel.id, businessDate, timezone: group.timezone, position: "EXPERT",
              sourceReceptionId: receptions[personIndex].id,
              sourceGroupOperatorId: operators[personIndex].id,
              values: expertValues(groupIndex, channelIndex, personIndex, dayIndex),
            });
          }
        }
      }
    }
  }, { timeout: 60_000 });

  const totals = await db.dailyStatEntry.groupBy({
    by: ["groupId"],
    where: { id: { startsWith: "report-demo-entry-" } },
    _count: { _all: true },
  });
  const customerRows = await db.leadCustomer.findMany({
    where: { id: { startsWith: "report-demo-customer-" } },
    select: {
      currentGroupId: true,
      batch: { select: { channelId: true } },
    },
  });
  const customerProgress = groups
    .filter((group) => group.departmentId === "demo-department")
    .map((group) => {
      const rows = customerRows.filter((customer) => customer.currentGroupId === group.id);
      return {
        groupId: group.id,
        groupName: group.name,
        customers: rows.length,
        channels: new Set(rows.map((customer) => customer.batch.channelId)).size,
      };
    });
  if (customerProgress.some((row) => row.customers !== 20 || row.channels !== 4)) {
    throw new Error(`客户进度演示数据校验失败：${JSON.stringify(customerProgress)}`);
  }
  console.log(JSON.stringify({
    action: "本地多组织报表演示数据已准备完成",
    password: PASSWORD,
    companies: companies.length,
    departments: departments.length,
    groups: groups.length,
    dailyEntries: totals,
    customerProgress,
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
