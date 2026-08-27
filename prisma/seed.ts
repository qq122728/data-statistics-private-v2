import { PrismaClient, Role } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const db = new PrismaClient();

function assertDevelopmentSeedIsAllowed() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("安全拦截：初始化种子只能连接本机 SQLite，禁止在 PostgreSQL 或生产数据库执行。");
  }
  if (process.env.ALLOW_DEVELOPMENT_SEED !== "YES") {
    throw new Error("安全拦截：种子会清空本地业务数据。请明确设置 ALLOW_DEVELOPMENT_SEED=YES 后再执行。");
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const initialAccounts = [
  { id: "initial-admin", username: "admin", name: "系统管理员", password: "Admin@56790", role: Role.ADMIN, groupId: null, departmentId: null },
  { id: "initial-resource", username: "resource", name: "投流资源部管理员", password: "Resource@56790", role: Role.RESOURCE_MANAGER, groupId: null, departmentId: null },
  { id: "initial-resource-sms", username: "resource_sms", name: "短信资源部管理员", password: "SmsResource@56790", role: Role.RESOURCE_MANAGER, groupId: null, departmentId: null },
  { id: "initial-company", username: "company", name: "A公司管理员", password: "Company@56790", role: Role.COMPANY_MANAGER, groupId: null, departmentId: "department-a" },
  { id: "initial-finance", username: "finance", name: "总公司财务", password: "Finance@56790", role: Role.FINANCE, groupId: null, departmentId: null },
  { id: "initial-lead", username: "lead", name: "A组组长", password: "Lead@56790", role: Role.LEAD, groupId: "group-a", departmentId: null },
  { id: "initial-reception", username: "reception", name: "前台接粉 A", password: "Reception@56790", role: Role.RECEPTION, groupId: "group-a", departmentId: null },
  { id: "a-reception-02", username: "reception_b", name: "前台接粉 B", password: "ReceptionB@56790", role: Role.RECEPTION, groupId: "group-a", departmentId: null },
  { id: "a-reception-03", username: "reception_c", name: "前台接粉 C", password: "ReceptionC@56790", role: Role.RECEPTION, groupId: "group-a", departmentId: null },
  { id: "a-reception-04", username: "reception_d", name: "前台接粉 D", password: "ReceptionD@56790", role: Role.RECEPTION, groupId: "group-a", departmentId: null },
  { id: "a-reception-05", username: "reception_e", name: "前台接粉 E", password: "ReceptionE@56790", role: Role.RECEPTION, groupId: "group-a", departmentId: null },
  { id: "a-reception-06", username: "reception_f", name: "前台接粉 F", password: "ReceptionF@56790", role: Role.RECEPTION, groupId: "group-a", departmentId: null },
  { id: "initial-operator", username: "operator", name: "前台炒群 A", password: "Operator@56790", role: Role.GROUP_OPERATOR, groupId: "group-a", departmentId: null },
  { id: "a-operator-02", username: "operator_b", name: "前台炒群 B", password: "OperatorB@56790", role: Role.GROUP_OPERATOR, groupId: "group-a", departmentId: null },
  { id: "initial-expert", username: "expert", name: "前台专家 A", password: "Expert@56790", role: Role.EXPERT, groupId: "group-a", departmentId: null },
] as const;

async function clearOperationalData() {
  await db.metricEvent.deleteMany();
  await db.customerOrder.deleteMany();
  await db.leadActivity.deleteMany();
  await db.leadException.deleteMany();
  await db.leadCustomer.deleteMany();
  await db.groupOperatorReception.deleteMany();
  await db.device.deleteMany();
  await db.deviceAccount.deleteMany();
  await db.dailyEntryConfirmation.deleteMany();
  await db.riskDecision.deleteMany();
  await db.session.deleteMany();
  await db.sourceBatch.deleteMany();
  await db.channel.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
  await db.teamGroup.deleteMany();
  await db.department.deleteMany();
}

async function main() {
  assertDevelopmentSeedIsAllowed();
  await clearOperationalData();

  await db.department.createMany({ data: [
    { id: "default-department", name: "系统默认部门", active: false },
    { id: "department-a", name: "A公司", active: true },
  ] });
  await db.teamGroup.create({ data: { id: "group-a", name: "A组", departmentId: "department-a" } });

  await db.user.createMany({
    data: initialAccounts.map(({ password, ...account }) => ({
      ...account,
      employeeCode: account.username,
      passwordHash: hashPassword(password),
      hireDate: "2026-08-15",
    })),
  });

  await db.userGroupMembership.createMany({ data: initialAccounts.flatMap((account) => account.groupId ? [{ id: `membership-${account.id}`, userId: account.id, groupId: account.groupId, role: account.role, effectiveFrom: "2026-08-15", reason: "初始化人员归属" }] : []) });

  await db.groupOperatorReception.createMany({ data: [
    { groupOperatorId: "initial-operator", receptionistId: "initial-reception" },
    { groupOperatorId: "initial-operator", receptionistId: "a-reception-02" },
    { groupOperatorId: "initial-operator", receptionistId: "a-reception-03" },
    { groupOperatorId: "a-operator-02", receptionistId: "a-reception-04" },
    { groupOperatorId: "a-operator-02", receptionistId: "a-reception-05" },
    { groupOperatorId: "a-operator-02", receptionistId: "a-reception-06" },
  ] });

  const settings = [
    ["appName", "数据统计"],
    ["timezone", "Asia/Shanghai"],
    ["defaultReportMode", "cumulative"],
    ["allowMemberChannelCreation", "true"],
  ] as const;
  for (const [key, value] of settings) {
    await db.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
