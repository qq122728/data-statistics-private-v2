import { db } from "../../src/lib/db";
import { autoMarkExpiredGroupMemberships, automaticLeaveCutoff } from "../../src/lib/group-lifecycle";
import { autoMarkExpiredLegacyGroupMemberships, countExpiredLegacyGroupMemberships } from "../../src/lib/legacy-group-lifecycle";
import { statisticsDate } from "../../src/lib/statistics-date";

async function main() {
  const [mode] = process.argv.slice(2);
  if (!["--dry-run", "--execute"].includes(mode) || process.argv.length !== 3) {
    throw new Error("用法：auto-leave-groups.ts --dry-run 或 --execute");
  }
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("自动退群只允许连接已配置的 PostgreSQL 数据库");
  }

  const today = statisticsDate();
  const cutoff = automaticLeaveCutoff(today);
  const where = {
    trackingArchivedAt: null,
    groupStatus: "JOINED" as const,
    joinedOn: { lte: cutoff },
  };
  const due = await db.leadCustomer.count({ where });
  const legacyDue = await countExpiredLegacyGroupMemberships({ today });
  if (mode === "--dry-run") {
    console.log(JSON.stringify({ mode: "preview", today, cutoff, due, legacyDue }));
    return;
  }
  const result = await autoMarkExpiredGroupMemberships({ today });
  const legacyResult = await autoMarkExpiredLegacyGroupMemberships({ today });
  const remaining = await db.leadCustomer.count({ where });
  const legacyRemaining = await countExpiredLegacyGroupMemberships({ today });
  console.log(JSON.stringify({ mode: "execute", today, cutoff, due, updated: result.updated, remaining, legacyDue, legacyUpdated: legacyResult.updated, legacyRemaining }));
  if (remaining > 0 || legacyRemaining > 0) throw new Error(`自动退群仍有 ${remaining + legacyRemaining} 条到期记录，请检查日志后重试`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "自动退群任务失败");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
