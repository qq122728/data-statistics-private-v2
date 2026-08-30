import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

if (process.env.CONFIRM_HENGSHENG_ORG_MIGRATION !== "YES") {
  throw new Error("必须显式设置 CONFIRM_HENGSHENG_ORG_MIGRATION=YES");
}

const db = new PrismaClient();

const departmentConfig = {
  US: { name: "美国部", timezone: "America/New_York" },
  DE: { name: "德国部", timezone: "Europe/Berlin" },
  SG: { name: "新加坡部", timezone: "Asia/Singapore" },
};

try {
  const before = await Promise.all([
    db.user.count(), db.teamGroup.count(), db.channel.count(), db.sourceBatch.count(),
    db.leadCustomer.count(), db.customerOrder.count(), db.metricEvent.count(),
  ]);
  const groups = await db.teamGroup.findMany({
    select: { id: true, name: true, countryCode: true },
    orderBy: { name: "asc" },
  });
  const unexpected = groups.filter((group) => !group.countryCode || !(group.countryCode in departmentConfig));
  if (unexpected.length) throw new Error(`存在无法归类的小组：${unexpected.map((group) => group.name).join("、")}`);

  const [systemAdmin, companyManager, regionalManager] = await Promise.all([
    db.user.findUnique({ where: { username: "845657" }, select: { id: true } }),
    db.user.findUnique({ where: { username: "hx5588" }, select: { id: true, name: true } }),
    db.user.findUnique({ where: { username: "wangmazi" }, select: { id: true, name: true } }),
  ]);
  if (!systemAdmin || !companyManager || !regionalManager) throw new Error("系统管理员、欢喜或王麻子账号不存在，停止迁移");

  const result = await db.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { name: "恒升部" },
      create: { id: randomUUID(), name: "恒升部", active: true },
      update: { active: true },
    });

    let usDepartment = await tx.department.findUnique({ where: { name: "美国部" } });
    if (!usDepartment) {
      const legacyDepartment = await tx.department.findUnique({ where: { name: "恒升部" } });
      if (!legacyDepartment) throw new Error("找不到待转换的旧“恒升部”部门");
      usDepartment = await tx.department.update({
        where: { id: legacyDepartment.id },
        data: { name: "美国部", companyId: company.id, countryCode: "US", timezone: departmentConfig.US.timezone, active: true },
      });
    } else {
      usDepartment = await tx.department.update({
        where: { id: usDepartment.id },
        data: { companyId: company.id, countryCode: "US", timezone: departmentConfig.US.timezone, active: true },
      });
    }

    const departmentByCountry = { US: usDepartment };
    for (const countryCode of ["DE", "SG"]) {
      const config = departmentConfig[countryCode];
      departmentByCountry[countryCode] = await tx.department.upsert({
        where: { name: config.name },
        create: { id: randomUUID(), name: config.name, companyId: company.id, countryCode, timezone: config.timezone, active: true },
        update: { companyId: company.id, countryCode, timezone: config.timezone, active: true },
      });
    }

    for (const group of groups) {
      const department = departmentByCountry[group.countryCode];
      await tx.teamGroup.update({ where: { id: group.id }, data: { departmentId: department.id } });
      await tx.user.updateMany({ where: { groupId: group.id }, data: { departmentId: department.id } });
    }

    await tx.user.update({
      where: { id: companyManager.id },
      data: {
        role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: company.id,
        departmentId: null, managementScopeName: null, managementCountryCode: null,
      },
    });
    await tx.userManagedDepartment.deleteMany({ where: { userId: companyManager.id } });

    await tx.user.update({
      where: { id: regionalManager.id },
      data: {
        role: "COMPANY_MANAGER", duty: "DEPARTMENT_MANAGER", companyId: null,
        departmentId: usDepartment.id, managementScopeName: null, managementCountryCode: null,
      },
    });
    await tx.userManagedDepartment.deleteMany({ where: { userId: regionalManager.id } });
    await tx.userManagedDepartment.createMany({
      data: [
        { userId: regionalManager.id, departmentId: usDepartment.id },
        { userId: regionalManager.id, departmentId: departmentByCountry.SG.id },
      ],
      skipDuplicates: true,
    });

    await tx.auditLog.createMany({ data: [
      {
        actorId: systemAdmin.id, action: "ORGANIZATION_SCOPE_MIGRATED", entityType: "User", entityId: companyManager.id,
        summary: JSON.stringify({ company: "恒升部", duty: "COMPANY_MANAGER", departments: ["美国部", "德国部", "新加坡部"] }),
      },
      {
        actorId: systemAdmin.id, action: "ORGANIZATION_SCOPE_MIGRATED", entityType: "User", entityId: regionalManager.id,
        summary: JSON.stringify({ company: "恒升部", duty: "DEPARTMENT_MANAGER", departments: ["美国部", "新加坡部"] }),
      },
    ] });

    return { company, departmentByCountry };
  }, { isolationLevel: "Serializable" });

  const after = await Promise.all([
    db.user.count(), db.teamGroup.count(), db.channel.count(), db.sourceBatch.count(),
    db.leadCustomer.count(), db.customerOrder.count(), db.metricEvent.count(),
  ]);
  if (before.join("|") !== after.join("|")) throw new Error(`业务数据数量发生变化：${before.join("|")} -> ${after.join("|")}`);

  console.log(JSON.stringify({
    ok: true,
    company: result.company.name,
    departments: Object.values(result.departmentByCountry).map((department) => department.name),
    invariantCounts: after,
  }));
} finally {
  await db.$disconnect();
}
