process.env.DATABASE_URL ||= "file:./dev.db";
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();
const apply = process.argv.includes("--apply");
const dates = ["2026-09-01", "2026-09-02"];
const numberFields = [
  "dispatchCount", "duplicateCount", "lowAmountCount", "noWsCount", "manualInvalidCount",
  "lawyerRealCaseCount", "lawyerAddedCount", "lawyerExpertAddedCount", "customerServicePushCount",
  "effectiveCount", "replyCount", "joinCount", "operatorReceivedCount", "normalLeaveCount",
  "abnormalLeaveCount", "currentInGroupCount", "expertIntroCount", "expertReceivedCount",
  "expertContactedCount", "registrationCount", "orderCount", "cryptoInitialDepositCents",
  "bankInitialDepositCents", "cryptoRechargeCents", "bankRechargeCents", "withdrawalCents",
];

function revisionData(source, version) {
  return {
    entryId: source.entryId,
    version,
    createdById: source.createdById,
    changeReason: "切换号码统计：清空 9 月 1-2 日旧手填进群数",
    ...Object.fromEntries(numberFields.map((field) => [field, field === "joinCount" ? 0 : source[field]])),
  };
}

try {
  const entries = await db.dailyStatEntry.findMany({
    where: { businessDate: { in: dates } },
    include: { currentRevision: true, approvedRevision: true, revisions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 } },
    orderBy: [{ businessDate: "asc" }, { groupId: "asc" }, { ownerId: "asc" }],
  });
  const affected = entries.filter((entry) =>
    (entry.currentRevision?.joinCount ?? 0) !== 0 || (entry.approvedRevision?.joinCount ?? 0) !== 0,
  );
  console.log(JSON.stringify({ mode: apply ? "APPLY" : "DRY_RUN", dates, affectedEntries: affected.length, joinCountBefore: affected.reduce((sum, entry) => sum + Math.max(entry.currentRevision?.joinCount ?? 0, entry.approvedRevision?.joinCount ?? 0), 0) }, null, 2));
  if (!apply || !affected.length) process.exit(0);

  await db.$transaction(async (tx) => {
    for (const entry of affected) {
      let version = entry.revisions[0]?.version ?? 0;
      const createdBySource = new Map();
      const createReplacement = async (source) => {
        if (!source || source.joinCount === 0) return source?.id ?? null;
        const cached = createdBySource.get(source.id);
        if (cached) return cached;
        version += 1;
        const replacement = await tx.dailyStatRevision.create({ data: revisionData(source, version), select: { id: true } });
        createdBySource.set(source.id, replacement.id);
        return replacement.id;
      };
      const currentRevisionId = await createReplacement(entry.currentRevision);
      const approvedRevisionId = await createReplacement(entry.approvedRevision);
      await tx.dailyStatEntry.update({ where: { id: entry.id }, data: {
        ...(currentRevisionId ? { currentRevisionId } : {}),
        ...(approvedRevisionId ? { approvedRevisionId } : {}),
      } });
    }
  });
  console.log(`已用新版本清空 ${affected.length} 条日报的手填进群数；历史版本仍保留可审计。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
