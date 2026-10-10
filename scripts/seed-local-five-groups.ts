import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { db } from "../src/lib/db";
import { createSheetRows, patchSheetRowInTransaction } from "../src/lib/customer-sheet";
import { syncNumberStatistics } from "../src/lib/number-statistics";
import { statisticsDate } from "../src/lib/statistics-date";

// This is only for the isolated local demonstration database. Never aim it at production.
const expectedDatabase = `file:${resolve(process.cwd(), "prisma/local-demo.db")}`;
if (process.env.ALLOW_LOCAL_FIVE_GROUP_SEED !== "YES" || process.env.DATABASE_URL !== expectedDatabase) {
  throw new Error("只允许明确指定本地 prisma/local-demo.db 后生成五组演示数据。", { cause: { expectedDatabase } });
}

const groups = [
  { id: "demo-group", name: "1组", countryCode: "US", timezone: "America/New_York" },
  { id: "demo-group-2", name: "2组", countryCode: "US", timezone: "America/New_York" },
  { id: "demo-group-3", name: "3组", countryCode: "US", timezone: "America/New_York" },
  { id: "demo-group-4", name: "4组德国", countryCode: "DE", timezone: "Europe/Berlin" },
  { id: "demo-group-5", name: "5组新加坡", countryCode: "SG", timezone: "Asia/Singapore" },
] as const;

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function dateOffset(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function ensureGroup(index: number) {
  const group = groups[index];
  await db.teamGroup.upsert({
    where: { id: group.id },
    update: { name: group.name, countryCode: group.countryCode, timezone: group.timezone, active: true },
    create: { ...group, departmentId: "demo-department", groupType: "HACKER" },
  });

  const people = index === 0
    ? { lead: "demo-lead", reception: "demo-reception", operator: "demo-operator", expert: "demo-expert" }
    : {
        lead: `demo-g${index + 1}-lead`, reception: `demo-g${index + 1}-reception`,
        operator: `demo-g${index + 1}-operator`, expert: `demo-g${index + 1}-expert`,
      };
  if (index !== 0) {
    for (const [job, role, label] of [
      ["lead", "LEAD", "组长"], ["reception", "RECEPTION", "接粉"],
      ["operator", "GROUP_OPERATOR", "炒群"], ["expert", "EXPERT", "专家"],
    ] as const) {
      const id = people[job];
      await db.user.upsert({
        where: { id },
        update: { name: `${group.name}演示${label}`, active: true, groupId: group.id },
        create: {
          id, employeeCode: id.replaceAll("-", "_"), username: id.replaceAll("-", "_"),
          name: `${group.name}演示${label}`, passwordHash: hashPassword("DemoGroup@56790"),
          role, groupId: group.id, hireDate: "2026-09-01", active: true,
        },
      });
      await db.userRoleAssignment.upsert({
        where: { userId_role: { userId: id, role } }, update: {}, create: { userId: id, role },
      });
      const historical = await db.userGroupMembership.findFirst({ where: { userId: id, groupId: group.id, effectiveTo: null } });
      if (!historical) await db.userGroupMembership.create({
        data: { userId: id, groupId: group.id, role, effectiveFrom: "2026-09-01", reason: "本地演示数据" },
      });
    }
    await db.groupOperatorReception.upsert({
      where: { groupOperatorId_receptionistId: { groupOperatorId: people.operator, receptionistId: people.reception } },
      update: {}, create: { groupOperatorId: people.operator, receptionistId: people.reception },
    });
  }

  const channels = index === 0
    ? ["demo-channel", "demo-channel-sms"]
    : [`demo-g${index + 1}-ads`, `demo-g${index + 1}-sms`];
  if (index !== 0) {
    for (const [channelIndex, id] of channels.entries()) {
      const name = `${group.name}演示${channelIndex === 0 ? "投流" : "短信"}渠道`;
      await db.channel.upsert({
        where: { id_groupId: { id, groupId: group.id } },
        update: { name, normalizedName: name.toLowerCase(), active: true },
        create: { id, groupId: group.id, name, normalizedName: name.toLowerCase(), createdById: people.lead },
      });
    }
  }
  return { group, people, channels };
}

function demoRow(groupIndex: number, rowIndex: number, today: string,
  people: { lead: string; reception: string; operator: string; expert: string }, channels: string[]) {
  const intakeOn = dateOffset(today, -(rowIndex % 10));
  const phone = `19900${String(groupIndex + 1).padStart(2, "0")}${String(rowIndex + 1).padStart(4, "0")}`;
  const stage = rowIndex % 12;
  const row: Record<string, string | number | boolean | null> = {
    phone, intakeOn, quality: "有效", ownerId: people.reception,
    operatorId: people.operator, channelId: channels[rowIndex % channels.length],
    note: `本地虚构客户 · ${groups[groupIndex].name} · 样本 ${rowIndex + 1}`,
  };
  if (stage >= 3) {
    row.replied = true;
    row.repliedOn = intakeOn;
  }
  if (stage >= 5) {
    row.joinedOn = intakeOn;
    row.device = `${groups[groupIndex].name}-设备-${rowIndex % 3 + 1}`;
  }
  if (stage === 6) {
    row.normalLeft = true;
    row.normalLeftOn = intakeOn;
  }
  if (stage === 7) {
    row.abnormalLeft = true;
    row.abnormalLeftOn = intakeOn;
  }
  if (stage >= 8) {
    row.expertId = people.expert;
    row.addedExpert = true;
    row.expertOn = intakeOn;
  }
  return row;
}

async function seedRows(index: number, people: { lead: string; reception: string; operator: string; expert: string }, channels: string[]) {
  const today = statisticsDate();
  const groupId = groups[index].id;
  const candidates = Array.from({ length: 36 }, (_, rowIndex) => demoRow(index, rowIndex, today, people, channels));
  const existing = await db.customerSheetRow.findMany({ where: { groupId }, select: { phone: true } });
  const present = new Set(existing.map(row => row.phone));
  const fresh = candidates.filter(row => !present.has(String(row.phone)));
  if (fresh.length) await createSheetRows(people.lead, { groupId, rows: fresh });

  // Experts fill their own fields. Batch the edits and recalculate reports once.
  const expertRows = await db.customerSheetRow.findMany({
    where: { groupId, phone: { in: candidates.filter((_, rowIndex) => rowIndex % 12 >= 8).map(row => String(row.phone)) } },
    select: { id: true, phone: true, version: true, data: true },
  });
  let enriched = 0;
  await db.$transaction(async tx => {
    for (const row of expertRows) {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      if (data.submitted === true) continue;
      const rowIndex = Number(row.phone.slice(-4)) - 1;
      const stage = rowIndex % 12;
      const values: Record<string, string | number | boolean> = {
        submitted: true, customerProgress: "演示客户：已由专家继续跟进", expertNote: "仅用于本地页面检查",
      };
      if (stage >= 9) values.traceStartedOn = String(data.expertOn);
      if (stage >= 10) {
        values.invitedOn = String(data.expertOn);
        values.registeredOn = String(data.expertOn);
      }
      if (stage === 11) {
        values.firstDeposit = (index + 1) * 250 + (rowIndex + 1) * 10;
        values.firstDepositOn = String(data.expertOn);
        values.firstDepositMethod = rowIndex % 2 ? "银行卡" : "加密货币";
      }
      await patchSheetRowInTransaction(tx, people.expert, row.id, { version: row.version, values }, false);
      enriched++;
    }
    if (enriched) await syncNumberStatistics(tx, groupId, people.expert);
  }, { timeout: 30000 });
  return { group: groups[index].name, added: fresh.length, total: await db.customerSheetRow.count({ where: { groupId } }) };
}

async function main() {
  if (!await db.department.findUnique({ where: { id: "demo-department" } })) {
    throw new Error("未找到本地演示公司，请先建立隔离的本地演示环境。");
  }
  const results = [];
  for (let index = 0; index < groups.length; index++) {
    const { people, channels } = await ensureGroup(index);
    results.push(await seedRows(index, people, channels));
  }
  console.log(JSON.stringify({ database: expectedDatabase, results }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
