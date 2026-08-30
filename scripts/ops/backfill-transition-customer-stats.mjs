import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const PREFIX = "transition-customer-v1";

function stableId(kind, key) {
  return `${PREFIX}-${kind}-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function emptyValues() {
  return {
    dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, effectiveCount: 0,
    replyCount: 0, joinCount: 0, operatorReceivedCount: 0, normalLeaveCount: 0,
    abnormalLeaveCount: 0, currentInGroupCount: 0, expertIntroCount: 0,
    expertReceivedCount: 0, expertContactedCount: 0, registrationCount: 0, orderCount: 0,
    cryptoInitialDepositCents: 0, bankInitialDepositCents: 0, cryptoRechargeCents: 0,
    bankRechargeCents: 0, withdrawalCents: 0,
  };
}

function dayNumber(joinedOn, leftOn) {
  if (!joinedOn || !leftOn) return null;
  const start = Date.parse(`${joinedOn}T00:00:00.000Z`);
  const end = Date.parse(`${leftOn}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

async function main() {
  if (process.env.CONFIRM_TRANSITION_CUSTOMER_STAT_BACKFILL !== "YES") {
    throw new Error("Set CONFIRM_TRANSITION_CUSTOMER_STAT_BACKFILL=YES to run this guarded backfill");
  }
  // Releases that ran the first legacy backfill before this correction stored total leaves
  // in normalLeaveCount and the abnormal subset separately. Repair only that exact migration
  // revision once, identified by its unchanged reason text.
  const legacyLeaveRows = await db.dailyStatRevision.findMany({
    where: {
      changeReason: "旧版独立统计账安全迁移",
      abnormalLeaveCount: { gt: 0 },
      entry: { id: { startsWith: "legacy-metric-v1" }, position: "GROUP_OPERATOR" },
    },
    select: { id: true, normalLeaveCount: true, abnormalLeaveCount: true },
  });
  for (const row of legacyLeaveRows) {
    await db.dailyStatRevision.update({
      where: { id: row.id },
      data: {
        normalLeaveCount: Math.max(0, row.normalLeaveCount - row.abnormalLeaveCount),
        changeReason: "旧版独立统计账安全迁移（已拆分正常/异常退群）",
      },
    });
  }

  const existing = await db.dailyStatEntry.count({ where: { id: { startsWith: PREFIX } } });
  if (existing) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "already_backfilled", entries: existing }));
    return;
  }

  const [events, leads] = await Promise.all([
    db.metricEvent.findMany({
      where: {
        voidedAt: null, derivedFromLedger: true,
        kind: { in: ["NEW_FANS", "EFFECTIVE_FANS", "DUPLICATE_FANS", "NO_NUMBER", "ORDER", "RECHARGE", "WITHDRAWAL"] },
      },
      select: {
        kind: true, quantity: true, amountCents: true, occurredOn: true, enteredById: true, depositMethod: true,
        batch: { select: { groupId: true, channelId: true, group: { select: { timezone: true, department: { select: { timezone: true } } } } } },
      },
    }),
    db.leadCustomer.findMany({
      where: { isHistoricalRecord: false },
      select: {
        ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true,
        repliedOn: true, joinedOn: true, leftOn: true, groupStatus: true,
        expertIntroducedOn: true, registeredOn: true,
        batch: {
          select: {
            sourceDate: true, groupId: true, channelId: true,
            group: { select: { timezone: true, department: { select: { timezone: true } }, members: { where: { role: "LEAD", active: true }, select: { id: true }, take: 1 } } },
          },
        },
      },
    }),
  ]);

  const aggregates = new Map();
  function rowFor({ ownerId, groupId, channelId, businessDate, timezone, position, sourceReceptionId = null, sourceGroupOperatorId = null }) {
    const key = JSON.stringify([ownerId, groupId, channelId, businessDate, position, sourceReceptionId, sourceGroupOperatorId]);
    const row = aggregates.get(key) ?? { key, ownerId, groupId, channelId, businessDate, timezone, position, sourceReceptionId, sourceGroupOperatorId, values: emptyValues() };
    aggregates.set(key, row);
    return row;
  }

  for (const event of events) {
    const position = ["NEW_FANS", "EFFECTIVE_FANS", "DUPLICATE_FANS", "NO_NUMBER"].includes(event.kind) ? "RECEPTION" : "EXPERT";
    const row = rowFor({
      ownerId: event.enteredById, groupId: event.batch.groupId, channelId: event.batch.channelId,
      businessDate: event.occurredOn, timezone: event.batch.group.timezone || event.batch.group.department?.timezone || "Asia/Shanghai", position,
    });
    const quantity = event.quantity ?? 0;
    const amount = event.amountCents ?? 0;
    if (event.kind === "NEW_FANS") row.values.dispatchCount += quantity;
    if (event.kind === "EFFECTIVE_FANS") row.values.effectiveCount += quantity;
    if (event.kind === "DUPLICATE_FANS") row.values.duplicateCount += quantity;
    if (event.kind === "NO_NUMBER") row.values.noWsCount += quantity;
    if (event.kind === "ORDER") row.values.orderCount += quantity;
    if (event.kind === "RECHARGE") {
      if (event.depositMethod === "BANK") row.values.bankRechargeCents += amount;
      else row.values.cryptoRechargeCents += amount;
    }
    if (event.kind === "WITHDRAWAL") row.values.withdrawalCents += amount;
  }

  let cutoffDate = "";
  for (const lead of leads) {
    const receptionId = lead.attributionOwnerId || lead.ownerId;
    const operatorId = lead.groupOperatorOwnerId || lead.batch.group.members[0]?.id || receptionId;
    const expertId = lead.expertOwnerId || lead.batch.group.members[0]?.id || receptionId;
    const timezone = lead.batch.group.timezone || lead.batch.group.department?.timezone || "Asia/Shanghai";
    cutoffDate = [cutoffDate, lead.batch.sourceDate, lead.repliedOn, lead.joinedOn, lead.leftOn, lead.expertIntroducedOn, lead.registeredOn].filter(Boolean).sort().at(-1) || cutoffDate;
    if (lead.repliedOn) rowFor({ ownerId: receptionId, groupId: lead.batch.groupId, channelId: lead.batch.channelId, businessDate: lead.repliedOn, timezone, position: "RECEPTION" }).values.replyCount += 1;
    if (lead.joinedOn) rowFor({ ownerId: receptionId, groupId: lead.batch.groupId, channelId: lead.batch.channelId, businessDate: lead.joinedOn, timezone, position: "RECEPTION" }).values.joinCount += 1;
    if (lead.leftOn) {
      const row = rowFor({ ownerId: operatorId, groupId: lead.batch.groupId, channelId: lead.batch.channelId, businessDate: lead.leftOn, timezone, position: "GROUP_OPERATOR", sourceReceptionId: receptionId });
      const days = dayNumber(lead.joinedOn, lead.leftOn);
      if (days !== null && days <= 8) row.values.abnormalLeaveCount += 1;
      else row.values.normalLeaveCount += 1;
    }
    if (lead.expertIntroducedOn) rowFor({ ownerId: operatorId, groupId: lead.batch.groupId, channelId: lead.batch.channelId, businessDate: lead.expertIntroducedOn, timezone, position: "GROUP_OPERATOR", sourceReceptionId: receptionId }).values.expertIntroCount += 1;
    if (lead.registeredOn) rowFor({ ownerId: expertId, groupId: lead.batch.groupId, channelId: lead.batch.channelId, businessDate: lead.registeredOn, timezone, position: "EXPERT", sourceReceptionId: receptionId, sourceGroupOperatorId: operatorId }).values.registrationCount += 1;
  }

  // Freeze the customers that were still in a group at cutover as one latest snapshot per real business line.
  for (const lead of leads.filter((item) => item.groupStatus === "JOINED")) {
    const receptionId = lead.attributionOwnerId || lead.ownerId;
    const operatorId = lead.groupOperatorOwnerId || lead.batch.group.members[0]?.id || receptionId;
    const timezone = lead.batch.group.timezone || lead.batch.group.department?.timezone || "Asia/Shanghai";
    rowFor({ ownerId: operatorId, groupId: lead.batch.groupId, channelId: lead.batch.channelId, businessDate: cutoffDate || lead.batch.sourceDate, timezone, position: "GROUP_OPERATOR", sourceReceptionId: receptionId }).values.currentInGroupCount += 1;
  }

  for (const row of aggregates.values()) {
    if (row.position === "RECEPTION") row.values.lowAmountCount = Math.max(0, row.values.dispatchCount - row.values.duplicateCount - row.values.noWsCount - row.values.effectiveCount);
  }

  const rows = [...aggregates.values()];
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const entryId = stableId("entry", row.key);
      const revisionId = stableId("revision", row.key);
      await tx.dailyStatEntry.create({ data: {
        id: entryId, identityKey: `${PREFIX}:${row.key}`, ownerId: row.ownerId, groupId: row.groupId,
        channelId: row.channelId, businessDate: row.businessDate, timezone: row.timezone, position: row.position,
        sourceReceptionId: row.sourceReceptionId, sourceGroupOperatorId: row.sourceGroupOperatorId,
        status: "APPROVED", submittedAt: new Date(), reviewedAt: new Date(),
      } });
      await tx.dailyStatRevision.create({ data: { id: revisionId, entryId, version: 1, createdById: row.ownerId, changeReason: "新旧系统切换前客户数据一次性结转", ...row.values } });
      await tx.dailyStatEntry.update({ where: { id: entryId }, data: { currentRevisionId: revisionId, approvedRevisionId: revisionId } });
    }
  }, { timeout: 120_000 });

  const sourceAdded = events.reduce((sum, event) => sum + (event.kind === "NEW_FANS" ? event.quantity ?? 0 : 0), 0);
  const migratedAdded = rows.reduce((sum, row) => sum + row.values.dispatchCount, 0);
  if (sourceAdded !== migratedAdded) throw new Error(`Transition reconciliation failed: source=${sourceAdded}, migrated=${migratedAdded}`);
  console.log(JSON.stringify({ ok: true, cutoffDate, customerRecords: leads.length, sourceEvents: events.length, entries: rows.length, added: migratedAdded }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => db.$disconnect());
