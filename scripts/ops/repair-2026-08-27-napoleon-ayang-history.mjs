import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BUSINESS_DATE = "2026-08-27";
const CONFIRMED = process.env.CONFIRM_NAPOLEON_AYANG_HISTORY_REPAIR === "YES";
const REASON = "修复拿破仑组、阿阳组 2026-08-27 历史统计转换错误";
const TARGETS = {
  "WM-拿破仑组": {
    dispatch: 961, duplicate: 0, lowAmount: 13, noWs: 113, effective: 835,
    reply: 384, join: 122, normalLeave: 12, abnormalLeave: 29, currentInGroup: 81,
    expertIntro: 47, registration: 15, order: 11,
    depositCents: 768_500, withdrawalCents: 259_900,
  },
  "WM-阿阳小组": {
    dispatch: 758, duplicate: 0, lowAmount: 33, noWs: 23, effective: 702,
    reply: 295, join: 79, normalLeave: 19, abnormalLeave: 0, currentInGroup: 60,
    expertIntro: 45, registration: 19, order: 4,
    depositCents: 472_200, withdrawalCents: 0,
  },
};

function revisionValues(revision) {
  return {
    dispatchCount: revision.dispatchCount,
    duplicateCount: revision.duplicateCount,
    lowAmountCount: revision.lowAmountCount,
    noWsCount: revision.noWsCount,
    effectiveCount: revision.effectiveCount,
    replyCount: revision.replyCount,
    joinCount: revision.joinCount,
    operatorReceivedCount: revision.operatorReceivedCount,
    normalLeaveCount: revision.normalLeaveCount,
    abnormalLeaveCount: revision.abnormalLeaveCount,
    currentInGroupCount: revision.currentInGroupCount,
    expertIntroCount: revision.expertIntroCount,
    expertReceivedCount: revision.expertReceivedCount,
    expertContactedCount: revision.expertContactedCount,
    registrationCount: revision.registrationCount,
    orderCount: revision.orderCount,
    cryptoInitialDepositCents: revision.cryptoInitialDepositCents,
    bankInitialDepositCents: revision.bankInitialDepositCents,
    cryptoRechargeCents: revision.cryptoRechargeCents,
    bankRechargeCents: revision.bankRechargeCents,
    withdrawalCents: revision.withdrawalCents,
  };
}

function addSummary(target, position, values) {
  if (position === "RECEPTION") {
    target.dispatch += values.dispatchCount;
    target.duplicate += values.duplicateCount;
    target.lowAmount += values.lowAmountCount;
    target.noWs += values.noWsCount;
    target.effective += values.effectiveCount;
    target.reply += values.replyCount;
    target.join += values.joinCount;
  } else if (position === "GROUP_OPERATOR") {
    target.normalLeave += values.normalLeaveCount;
    target.abnormalLeave += values.abnormalLeaveCount;
    target.currentInGroup += values.currentInGroupCount;
    target.expertIntro += values.expertIntroCount;
  } else if (position === "EXPERT") {
    target.registration += values.registrationCount;
    target.order += values.orderCount;
    target.depositCents += values.cryptoInitialDepositCents + values.bankInitialDepositCents
      + values.cryptoRechargeCents + values.bankRechargeCents;
    target.withdrawalCents += values.withdrawalCents;
  }
}

function emptySummary() {
  return {
    dispatch: 0, duplicate: 0, lowAmount: 0, noWs: 0, effective: 0,
    reply: 0, join: 0, normalLeave: 0, abnormalLeave: 0, currentInGroup: 0,
    expertIntro: 0, registration: 0, order: 0, depositCents: 0, withdrawalCents: 0,
  };
}

function assertExpected(groupName, actual) {
  const expected = TARGETS[groupName];
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${groupName} 修复预览不符：${key} 应为 ${value}，实际为 ${actual[key]}`);
    }
  }
}

async function prepare() {
  const groups = await db.teamGroup.findMany({
    where: { name: { in: Object.keys(TARGETS) } },
    select: { id: true, name: true },
  });
  if (groups.length !== Object.keys(TARGETS).length) throw new Error("目标小组数量不正确");
  const groupIds = groups.map((group) => group.id);

  const legacyEntries = await db.dailyStatEntry.findMany({
    where: {
      groupId: { in: groupIds }, businessDate: BUSINESS_DATE,
      id: { startsWith: "legacy-metric-v1" }, approvedRevisionId: { not: null },
    },
    include: {
      approvedRevision: true,
      revisions: { orderBy: { version: "desc" }, take: 1 },
      owner: { select: { name: true, username: true } },
      channel: { select: { name: true } },
    },
  });
  const transitionEntries = await db.dailyStatEntry.findMany({
    where: {
      groupId: { in: groupIds }, businessDate: BUSINESS_DATE,
      id: { startsWith: "transition-customer-v1" },
    },
    include: { currentRevision: true, owner: { select: { name: true, username: true } } },
  });
  const invalidReports = await db.invalidFanReport.findMany({
    where: {
      status: "APPROVED",
      batch: { groupId: { in: groupIds }, sourceDate: BUSINESS_DATE },
    },
    select: {
      reporterId: true, approvedNoWsCount: true, approvedLowAmountCount: true,
      approvedCollisionCount: true, noWsCount: true, lowAmountCount: true, collisionCount: true,
      batch: { select: { groupId: true, channelId: true } },
    },
  });
  const invalidByLine = new Map(invalidReports.map((report) => [
    `${report.batch.groupId}:${report.batch.channelId}:${report.reporterId}`,
    {
      noWs: report.approvedNoWsCount ?? report.noWsCount,
      lowAmount: report.approvedLowAmountCount ?? report.lowAmountCount,
      duplicate: report.approvedCollisionCount ?? report.collisionCount,
    },
  ]));

  const receptionByLine = new Map();
  for (const entry of legacyEntries) {
    if (entry.position === "RECEPTION") receptionByLine.set(`${entry.groupId}:${entry.channelId}:${entry.ownerId}`, entry);
  }

  const updates = [];
  const summaries = new Map(groups.map((group) => [group.id, emptySummary()]));
  for (const entry of legacyEntries) {
    if (!entry.approvedRevision) throw new Error(`记录没有生效版本：${entry.id}`);
    const values = revisionValues(entry.approvedRevision);
    const lineKey = `${entry.groupId}:${entry.channelId}:${entry.ownerId}`;
    if (entry.position === "RECEPTION") {
      const invalid = invalidByLine.get(lineKey) ?? { noWs: 0, lowAmount: 0, duplicate: 0 };
      values.noWsCount = invalid.noWs;
      values.lowAmountCount = invalid.lowAmount;
      values.duplicateCount = invalid.duplicate;
      values.dispatchCount = values.effectiveCount + invalid.noWs + invalid.lowAmount + invalid.duplicate;
    } else if (entry.position === "GROUP_OPERATOR") {
      const reception = receptionByLine.get(lineKey);
      if (!reception?.approvedRevision) throw new Error(`炒群记录找不到同线接粉记录：${entry.id}`);
      values.currentInGroupCount = Math.max(0,
        reception.approvedRevision.joinCount - values.normalLeaveCount - values.abnormalLeaveCount);
    }
    addSummary(summaries.get(entry.groupId), entry.position, values);
    const before = revisionValues(entry.approvedRevision);
    if (JSON.stringify(before) !== JSON.stringify(values)) updates.push({ entry, before, values });
  }

  for (const group of groups) assertExpected(group.name, summaries.get(group.id));
  return { groups, updates, transitionEntries, summaries };
}

async function main() {
  const prepared = await prepare();
  const preview = {
    mode: CONFIRMED ? "WRITE" : "PREVIEW",
    businessDate: BUSINESS_DATE,
    revisionsToCreate: prepared.updates.length,
    transitionDuplicatesToRemove: prepared.transitionEntries.map((entry) => ({
      id: entry.id, owner: entry.owner.name, username: entry.owner.username,
      position: entry.position, values: entry.currentRevision ? revisionValues(entry.currentRevision) : null,
    })),
    repairedTotals: Object.fromEntries(prepared.groups.map((group) => [group.name, prepared.summaries.get(group.id)])),
  };
  console.log(JSON.stringify(preview, null, 2));
  if (!CONFIRMED) return;

  await db.$transaction(async (tx) => {
    for (const { entry, before, values } of prepared.updates) {
      const version = (entry.revisions[0]?.version ?? 0) + 1;
      const revision = await tx.dailyStatRevision.create({ data: {
        entryId: entry.id, version, createdById: entry.ownerId, changeReason: REASON, ...values,
      } });
      await tx.dailyStatEntry.update({ where: { id: entry.id }, data: {
        currentRevisionId: revision.id, approvedRevisionId: revision.id, status: "APPROVED",
        submittedAt: new Date(), reviewedAt: new Date(), reviewReason: null,
      } });
      await tx.auditLog.create({ data: {
        actorId: entry.ownerId, action: "REPAIR_HISTORICAL_DAILY_STAT",
        entityType: "DailyStatEntry", entityId: entry.id,
        summary: JSON.stringify({ reason: REASON, businessDate: BUSINESS_DATE, before, after: values }),
      } });
    }
    for (const entry of prepared.transitionEntries) {
      await tx.auditLog.create({ data: {
        actorId: entry.ownerId, action: "REMOVE_DUPLICATE_TRANSITION_DAILY_STAT",
        entityType: "DailyStatEntry", entityId: entry.id,
        summary: JSON.stringify({ reason: REASON, businessDate: BUSINESS_DATE, previousRevision: entry.currentRevision }),
      } });
      await tx.dailyStatEntry.delete({ where: { id: entry.id } });
    }
  }, { timeout: 120_000 });

  const verified = await prepare();
  if (verified.updates.length || verified.transitionEntries.length) throw new Error("修复后复核仍有待处理记录");
  console.log(JSON.stringify({ ok: true, verifiedTotals: Object.fromEntries(
    verified.groups.map((group) => [group.name, verified.summaries.get(group.id)]),
  ) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
