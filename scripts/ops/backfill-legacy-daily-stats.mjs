import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const PREFIX = "legacy-metric-v1";

function stableId(kind, key) {
  return `${PREFIX}-${kind}-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function positionFor(kind) {
  if (["NEW_FANS", "EFFECTIVE_FANS", "NO_NUMBER", "DUPLICATE_FANS", "REPLIES", "GROUP_JOIN"].includes(kind)) return "RECEPTION";
  if (["GROUP_LEAVE", "ABNORMAL_GROUP_LEAVE", "EXPERT_INTRO"].includes(kind)) return "GROUP_OPERATOR";
  if (["REGISTRATION", "ORDER", "RECHARGE", "WITHDRAWAL", "CHANNEL_PERFORMANCE"].includes(kind)) return "EXPERT";
  return null;
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

function apply(values, event) {
  const quantity = event.quantity ?? 0;
  const amount = event.amountCents ?? 0;
  if (event.kind === "NEW_FANS") values.dispatchCount += quantity;
  if (event.kind === "EFFECTIVE_FANS") values.effectiveCount += quantity;
  if (event.kind === "NO_NUMBER") values.noWsCount += quantity;
  if (event.kind === "DUPLICATE_FANS") values.duplicateCount += quantity;
  if (event.kind === "REPLIES") values.replyCount += quantity;
  if (event.kind === "GROUP_JOIN") values.joinCount += quantity;
  if (event.kind === "GROUP_LEAVE") values.normalLeaveCount += quantity;
  if (event.kind === "ABNORMAL_GROUP_LEAVE") values.abnormalLeaveCount += quantity;
  if (event.kind === "EXPERT_INTRO") values.expertIntroCount += quantity;
  if (event.kind === "REGISTRATION") values.registrationCount += quantity;
  if (event.kind === "ORDER") values.orderCount += quantity;
  if (event.kind === "RECHARGE") values.cryptoRechargeCents += amount;
  if (event.kind === "WITHDRAWAL") values.withdrawalCents += amount;
}

async function main() {
  if (process.env.CONFIRM_LEGACY_DAILY_STAT_BACKFILL !== "YES") {
    throw new Error("Set CONFIRM_LEGACY_DAILY_STAT_BACKFILL=YES to run this guarded backfill");
  }

  const existing = await db.dailyStatEntry.count({ where: { id: { startsWith: PREFIX } } });
  if (existing) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "already_backfilled", entries: existing }));
    return;
  }

  // Only old, explicitly entered statistics are copied. Customer-ledger compatibility
  // events are intentionally excluded because customer progress is now independent.
  const events = await db.metricEvent.findMany({
    where: { voidedAt: null, derivedFromLedger: false },
    select: {
      kind: true, quantity: true, amountCents: true, occurredOn: true, enteredById: true,
      batch: {
        select: {
          groupId: true, channelId: true,
          group: { select: { timezone: true, department: { select: { timezone: true } } } },
        },
      },
    },
  });

  const aggregates = new Map();
  for (const event of events) {
    const position = positionFor(event.kind);
    if (!position) continue;
    const key = JSON.stringify([event.enteredById, event.batch.groupId, event.batch.channelId, event.occurredOn, position]);
    const row = aggregates.get(key) ?? {
      key, ownerId: event.enteredById, groupId: event.batch.groupId, channelId: event.batch.channelId,
      businessDate: event.occurredOn, timezone: event.batch.group.timezone || event.batch.group.department?.timezone || "Asia/Shanghai",
      position, values: emptyValues(),
    };
    apply(row.values, event);
    aggregates.set(key, row);
  }

  // The old form stored effective count directly. Recover the old low-amount count
  // as the exact remainder so the new formula still reconciles.
  for (const row of aggregates.values()) {
    if (row.position === "RECEPTION") {
      row.values.lowAmountCount = Math.max(0,
        row.values.dispatchCount - row.values.duplicateCount - row.values.noWsCount - row.values.effectiveCount);
    }
  }

  const rows = [...aggregates.values()];
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const entryId = stableId("entry", row.key);
      const revisionId = stableId("revision", row.key);
      await tx.dailyStatEntry.create({
        data: {
          id: entryId, identityKey: `${PREFIX}:${row.key}`, ownerId: row.ownerId,
          groupId: row.groupId, channelId: row.channelId, businessDate: row.businessDate,
          timezone: row.timezone, position: row.position, status: "APPROVED",
          submittedAt: new Date(), reviewedAt: new Date(),
        },
      });
      await tx.dailyStatRevision.create({
        data: {
          id: revisionId, entryId, version: 1, createdById: row.ownerId,
          changeReason: "旧版独立统计账安全迁移", ...row.values,
        },
      });
      await tx.dailyStatEntry.update({
        where: { id: entryId },
        data: { currentRevisionId: revisionId, approvedRevisionId: revisionId },
      });
    }
  }, { timeout: 120_000 });

  const source = events.reduce((sum, event) => sum + (event.kind === "NEW_FANS" ? event.quantity ?? 0 : 0), 0);
  const migrated = rows.reduce((sum, row) => sum + row.values.dispatchCount, 0);
  if (source !== migrated) throw new Error(`Backfill reconciliation failed: source=${source}, migrated=${migrated}`);
  console.log(JSON.stringify({ ok: true, sourceEvents: events.length, entries: rows.length, added: migrated }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => db.$disconnect());
