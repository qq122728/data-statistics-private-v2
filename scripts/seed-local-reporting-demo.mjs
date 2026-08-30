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
  { id: "demo-group", name: "美国一组", departmentId: "demo-department", countryCode: "US", timezone: "America/New_York", channelId: "demo-channel", channelName: "演示投流A" },
  { id: "report-demo-group-us-2", name: "美国二组", departmentId: "demo-department", countryCode: "US", timezone: "America/New_York", channelId: "report-demo-channel-us-2", channelName: "演示投流B" },
  { id: "report-demo-group-de-1", name: "德国一组", departmentId: "report-demo-department-de", countryCode: "DE", timezone: "Europe/Berlin", channelId: "report-demo-channel-de-1", channelName: "演示短信A" },
  { id: "report-demo-group-uk-1", name: "英国一组", departmentId: "report-demo-department-uk", countryCode: "GB", timezone: "Europe/London", channelId: "report-demo-channel-uk-1", channelName: "演示投流C" },
];

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

function receptionValues(groupIndex, personIndex, dayIndex) {
  const dispatchCount = 12 + groupIndex * 3 + personIndex * 2 + dayIndex;
  const duplicateCount = 1 + ((groupIndex + personIndex + dayIndex) % 3);
  const lowAmountCount = (groupIndex + dayIndex) % 3;
  const noWsCount = (personIndex + dayIndex) % 2;
  const effectiveCount = dispatchCount - duplicateCount - lowAmountCount - noWsCount;
  return {
    dispatchCount, duplicateCount, lowAmountCount, noWsCount, effectiveCount,
    replyCount: Math.max(1, Math.floor(effectiveCount * (0.35 + personIndex * 0.05))),
    joinCount: Math.max(1, Math.floor(effectiveCount * 0.2)),
  };
}

function operatorValues(groupIndex, personIndex, dayIndex) {
  const operatorReceivedCount = 7 + groupIndex + personIndex + dayIndex;
  const normalLeaveCount = (dayIndex + personIndex) % 3;
  const abnormalLeaveCount = (groupIndex + dayIndex) % 2;
  return {
    operatorReceivedCount,
    normalLeaveCount,
    abnormalLeaveCount,
    currentInGroupCount: 9 + groupIndex * 2 + personIndex * 3 + dayIndex,
    expertIntroCount: 2 + ((groupIndex + personIndex + dayIndex) % 4),
  };
}

function expertValues(groupIndex, personIndex, dayIndex) {
  const expertReceivedCount = 3 + ((groupIndex + personIndex + dayIndex) % 4);
  const expertContactedCount = Math.max(1, expertReceivedCount - 1);
  const registrationCount = Math.max(0, expertContactedCount - ((dayIndex + personIndex) % 2));
  const orderCount = Math.max(0, registrationCount - ((groupIndex + dayIndex) % 2));
  const cryptoInitialDepositCents = orderCount * (45_000 + groupIndex * 10_000 + personIndex * 5_000);
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
      await tx.channel.upsert({
        where: { id_groupId: { id: group.channelId, groupId: group.id } },
        update: { name: group.channelName, normalizedName: group.channelName, channelType: group.channelName.includes("短信") ? "SMS" : "ADS", active: true },
        create: { id: group.channelId, groupId: group.id, name: group.channelName, normalizedName: group.channelName, channelType: group.channelName.includes("短信") ? "SMS" : "ADS", active: true },
      });

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

      // 连续三周都准备数据，才能同时检查“每日明细、近7天、近30天、本月”四种视图。
      const days = Array.from({ length: 21 }, (_, offset) => offset);
      for (const [dayIndex, offset] of days.entries()) {
        const businessDate = date(offset);
        const receptions = [people.receptionA, people.receptionB];
        const operators = [people.operatorA, people.operatorB];
        const experts = [people.expert, people.lead];

        for (const [personIndex, person] of receptions.entries()) {
          await createApprovedEntry(tx, {
            id: `report-demo-entry-${groupIndex}-r${personIndex}-${businessDate}`,
            ownerId: person.id, groupId: group.id, channelId: group.channelId, businessDate, timezone: group.timezone, position: "RECEPTION",
            values: receptionValues(groupIndex, personIndex, dayIndex),
          });
        }
        for (const [personIndex, person] of operators.entries()) {
          await createApprovedEntry(tx, {
            id: `report-demo-entry-${groupIndex}-o${personIndex}-${businessDate}`,
            ownerId: person.id, groupId: group.id, channelId: group.channelId, businessDate, timezone: group.timezone, position: "GROUP_OPERATOR",
            sourceReceptionId: receptions[personIndex].id,
            values: operatorValues(groupIndex, personIndex, dayIndex),
          });
        }
        for (const [personIndex, person] of experts.entries()) {
          await createApprovedEntry(tx, {
            id: `report-demo-entry-${groupIndex}-e${personIndex}-${businessDate}`,
            ownerId: person.id, groupId: group.id, channelId: group.channelId, businessDate, timezone: group.timezone, position: "EXPERT",
            sourceReceptionId: receptions[personIndex].id,
            sourceGroupOperatorId: operators[personIndex].id,
            values: expertValues(groupIndex, personIndex, dayIndex),
          });
        }
      }
    }
  }, { timeout: 60_000 });

  const totals = await db.dailyStatEntry.groupBy({
    by: ["groupId"],
    where: { id: { startsWith: "report-demo-entry-" } },
    _count: { _all: true },
  });
  console.log(JSON.stringify({
    action: "本地多组织报表演示数据已准备完成",
    password: PASSWORD,
    companies: companies.length,
    departments: departments.length,
    groups: groups.length,
    dailyEntries: totals,
  }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
