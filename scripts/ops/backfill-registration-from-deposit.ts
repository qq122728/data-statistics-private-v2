import { db } from "../../src/lib/db";
import { backfillRegistrationFromDeposit, previewRegistrationBackfill } from "../../src/lib/backfill-registration-from-deposit";

async function main() {
  const [mode] = process.argv.slice(2);
  if (!["--dry-run", "--execute"].includes(mode) || process.argv.length !== 3)
    throw new Error("用法：backfill-registration-from-deposit.ts --dry-run 或 --execute");
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? ""))
    throw new Error("修复任务只允许连接已配置的 PostgreSQL 数据库");
  const before = await previewRegistrationBackfill();
  if (mode === "--dry-run") {
    console.log(JSON.stringify({ mode: "preview", ...before }));
    return;
  }
  if (before.needsReview) throw new Error(`${before.needsReview} 条首充记录日期有冲突或缺失，请先核查，未修改数据`);
  const result = await backfillRegistrationFromDeposit();
  const after = await previewRegistrationBackfill();
  console.log(JSON.stringify({ mode: "execute", before, ...result, after }));
  if (after.eligible || after.needsReview) throw new Error("仍有首充未补注册，请检查后重试");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "补注册任务失败");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
