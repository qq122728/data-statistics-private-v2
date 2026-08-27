import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

// 仅清理本机 SQLite 的演示业务数据；不连接也不影响服务器数据库。
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:")) {
  throw new Error("此清理脚本只能用于本地 SQLite 数据库。");
}
if (process.env.CONFIRM_LOCAL_SIMULATION_CLEAR !== "YES") {
  throw new Error("安全拦截：此脚本会清空本机业务演示数据。确认后请设置 CONFIRM_LOCAL_SIMULATION_CLEAR=YES。");
}

const db = new PrismaClient({
  datasourceUrl: `file:${resolve(process.cwd(), "prisma/dev.db")}`,
});

const demoGroupIds = ["demo-group", "demo-company-group-b", "demo-company-group-c"];
const demoChannelNamesInAGroup = ["颜色状态演示渠道", "演示-A组-投流渠道", "演示-A组-短信渠道", "500号导入演示-20260817"];

async function main() {
  const before = await Promise.all([
    db.sourceBatch.count(), db.leadCustomer.count(), db.customerOrder.count(), db.metricEvent.count(),
    db.leadActivity.count(), db.leadException.count(), db.attendanceRecord.count(), db.notification.count(),
  ]);

  await db.$transaction(async (tx) => {
    // 先删依赖数据，再删客户和批次，防止外键留下孤儿数据。
    await tx.notificationRecipient.deleteMany();
    await tx.notification.deleteMany();
    await tx.attendanceRecord.deleteMany();
    await tx.dailyEntryConfirmation.deleteMany();
    await tx.invalidFanReportAudit.deleteMany();
    await tx.invalidFanReport.deleteMany();
    await tx.metricEvent.deleteMany();
    await tx.customerOrder.deleteMany();
    await tx.leadActivity.deleteMany();
    await tx.leadException.deleteMany();
    await tx.leadCustomer.deleteMany();
    await tx.sourceBatch.deleteMany();

    // 移除明确标识为演示用途的公司、小组、成员与渠道。
    const demoUsers = await tx.user.findMany({
      where: { OR: [{ id: { startsWith: "demo-" } }, { groupId: { in: demoGroupIds } }] },
      select: { id: true },
    });
    const demoUserIds = demoUsers.map((user) => user.id);
    await tx.session.deleteMany({ where: { userId: { in: demoUserIds } } });
    await tx.groupOperatorReception.deleteMany({
      where: { OR: [{ groupOperatorId: { in: demoUserIds } }, { receptionistId: { in: demoUserIds } }] },
    });
    await tx.deviceAccount.deleteMany({ where: { groupId: { in: demoGroupIds } } });
    await tx.device.deleteMany({ where: { groupId: { in: demoGroupIds } } });
    await tx.channel.deleteMany({ where: { groupId: { in: demoGroupIds } } });
    await tx.channel.deleteMany({ where: { groupId: "group-a", name: { in: demoChannelNamesInAGroup } } });
    await tx.auditLog.deleteMany({ where: { actorId: { in: demoUserIds } } });
    await tx.riskDecision.deleteMany({ where: { OR: [{ memberId: { in: demoUserIds } }, { actorId: { in: demoUserIds } }] } });
    await tx.user.deleteMany({ where: { id: { in: demoUserIds } } });
    await tx.teamGroup.deleteMany({ where: { id: { in: demoGroupIds } } });
    await tx.department.deleteMany({ where: { id: "demo-department" } });
  });

  const after = await Promise.all([
    db.sourceBatch.count(), db.leadCustomer.count(), db.customerOrder.count(), db.metricEvent.count(),
    db.leadActivity.count(), db.leadException.count(), db.attendanceRecord.count(), db.notification.count(),
  ]);
  console.log(JSON.stringify({ before, after }, null, 2));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => db.$disconnect());
