import { db } from "../../src/lib/db";
import { previewAutoLeaveClassificationRepair, repairAutoLeaveClassification } from "../../src/lib/repair-auto-leave-classification";

async function main() {
  const [mode] = process.argv.slice(2);
  if (!["--dry-run", "--execute"].includes(mode) || process.argv.length !== 3) {
    throw new Error("用法：repair-auto-leave-classification.ts --dry-run 或 --execute");
  }
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("修复任务只允许连接已配置的 PostgreSQL 数据库");
  }
  const before = await previewAutoLeaveClassificationRepair();
  if (mode === "--dry-run") {
    console.log(JSON.stringify({ mode: "preview", ...before }));
    return;
  }
  const result = await repairAutoLeaveClassification();
  const after = await previewAutoLeaveClassificationRepair();
  console.log(JSON.stringify({ mode: "execute", before, ...result, after }));
  if (after.legacy || after.leads) throw new Error("仍有自动退群被记为异常，请检查后重试");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "自动退群分类修复失败");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
