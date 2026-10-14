import { db } from "../../src/lib/db";
import type { SheetData } from "../../packages/customer-sheet/schema";
import { progressDateError } from "../../packages/customer-sheet/progress-dates";
import { statisticsDate } from "../../src/lib/statistics-date";
import { assignActionNumbers } from "../../src/lib/sheet-action-numbers";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import { syncNumberStatistics } from "../../src/lib/number-statistics";

const ROW_ID = "cmtrxeg4q01vpv0jj89fzewx4";
const DATE = "2026-09-10";
const ACTOR_ID = "system:expert-date-correction";

async function main() {
  const [mode] = process.argv.slice(2);
  if (!["--dry-run", "--execute"].includes(mode) || process.argv.length !== 3)
    throw new Error("用法：repair-expert-date-568809.ts --dry-run 或 --execute");
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? ""))
    throw new Error("日期更正只允许连接已配置的 PostgreSQL 数据库");

  const row = await db.customerSheetRow.findUnique({ where: { id: ROW_ID }, include: { group: true } });
  if (!row || row.group.name !== "WM-西瓜小组" || !row.phone.endsWith("568809"))
    throw new Error("客户记录与核对目标不符，未修改数据");
  const previous = JSON.parse(row.data) as SheetData;
  if (previous.__deletedAt || previous.expertOn || previous.registeredOn !== DATE || previous.traceStartedOn !== DATE
    || previous.invitedOn !== DATE || previous.firstDepositOn !== "2026-09-13" || !previous.expertId)
    throw new Error("客户记录已变化或日期不符合核对结果，未修改数据");
  const next: SheetData = { ...previous, addedExpert: true, expertOn: DATE };
  const error = progressDateError(next, previous, statisticsDate());
  if (error) throw new Error(error);
  if (mode === "--dry-run") {
    console.log(JSON.stringify({ mode: "preview", group: row.group.name, suffix: "568809", version: row.version,
      expertOn: DATE, registeredOn: previous.registeredOn, firstDepositOn: previous.firstDepositOn }));
    return;
  }

  await db.user.upsert({
    where: { id: ACTOR_ID },
    create: { id: ACTOR_ID, username: "__system_expert_date_correction__", name: "系统按核实日期补推专家", role: "RECEPTION", active: false },
    update: {},
  });
  await db.$transaction(async (tx) => {
    const current = await tx.customerSheetRow.findUniqueOrThrow({ where: { id: ROW_ID } });
    if (current.version !== row.version || current.data !== row.data) throw new Error("客户记录被其他人修改，请重新核对");
    await assignActionNumbers(tx, sheetStatisticsGroup(row.groupId, next), next);
    const after = JSON.stringify(next);
    const saved = await tx.customerSheetRow.updateMany({
      where: { id: ROW_ID, version: row.version },
      data: { data: after, version: { increment: 1 } },
    });
    if (saved.count !== 1) throw new Error("客户记录保存失败，请重新核对");
    await tx.customerSheetRevision.create({
      data: { rowId: ROW_ID, version: row.version + 1, actorId: ACTOR_ID, before: row.data, after },
    });
    await syncNumberStatistics(tx, row.groupId, ACTOR_ID);
  }, { timeout: 120000 });
  console.log(JSON.stringify({ mode: "execute", group: row.group.name, suffix: "568809", expertOn: DATE,
    registeredOn: previous.registeredOn, firstDepositOn: previous.firstDepositOn }));
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : "日期更正失败"); process.exitCode = 1; })
  .finally(() => db.$disconnect());
