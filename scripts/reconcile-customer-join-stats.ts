import { db } from "../src/lib/db";
import {
  inspectCustomerJoinEvent,
  reconcileCustomerJoinEvent,
  type NumberTrackedLead,
} from "../src/lib/customer-number-event-sync";
import { CUSTOMER_NUMBER_TRACKING_FROM } from "../src/lib/customer-number-tracking";

type Bucket = {
  key: string;
  businessDate: string;
  lead: NumberTrackedLead;
};

function bucketKey(groupId: string, channelId: string, businessDate: string, sourceReceptionId: string) {
  return [groupId, channelId, businessDate, sourceReceptionId].join(":");
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.CONFIRM_JOIN_STAT_RECONCILIATION !== "YES") {
    throw new Error("正式校正必须设置 CONFIRM_JOIN_STAT_RECONCILIATION=YES");
  }

  const [customers, recordedEntries] = await Promise.all([
  db.leadCustomer.findMany({
    where: { joinedOn: { gte: CUSTOMER_NUMBER_TRACKING_FROM } },
    select: {
      phone: true,
      joinedOn: true,
      ownerId: true,
      attributionOwnerId: true,
      groupOperatorOwnerId: true,
      expertOwnerId: true,
      batch: { select: { groupId: true, channelId: true } },
    },
  }),
  db.dailyStatEntry.findMany({
    where: {
      businessDate: { gte: CUSTOMER_NUMBER_TRACKING_FROM },
      position: "GROUP_OPERATOR",
      sourceReceptionId: { not: null },
      currentRevisionId: { not: null },
    },
    select: {
      ownerId: true,
      groupId: true,
      channelId: true,
      businessDate: true,
      sourceReceptionId: true,
      sourceGroupOperatorId: true,
      currentRevision: { select: { operatorReceivedCount: true } },
    },
  }),
  ]);

  const buckets = new Map<string, Bucket>();
  for (const customer of customers) {
    if (!customer.joinedOn) continue;
    const sourceReceptionId = customer.attributionOwnerId ?? customer.ownerId;
    const key = bucketKey(customer.batch.groupId, customer.batch.channelId, customer.joinedOn, sourceReceptionId);
    buckets.set(key, {
      key,
      businessDate: customer.joinedOn,
      lead: {
        phone: "全量进群校正",
        ownerId: customer.ownerId,
        attributionOwnerId: customer.attributionOwnerId,
        groupOperatorOwnerId: customer.groupOperatorOwnerId,
        expertOwnerId: customer.expertOwnerId,
        batch: customer.batch,
      },
    });
  }
  for (const entry of recordedEntries) {
    if (!entry.sourceReceptionId || (entry.currentRevision?.operatorReceivedCount ?? 0) <= 0) continue;
    const key = bucketKey(entry.groupId, entry.channelId, entry.businessDate, entry.sourceReceptionId);
    if (buckets.has(key)) continue;
    buckets.set(key, {
      key,
      businessDate: entry.businessDate,
      lead: {
        phone: "全量进群校正",
        ownerId: entry.sourceReceptionId,
        attributionOwnerId: entry.sourceReceptionId,
        groupOperatorOwnerId: entry.sourceGroupOperatorId ?? entry.ownerId,
        expertOwnerId: null,
        batch: { groupId: entry.groupId, channelId: entry.channelId },
      },
    });
  }

  const differences: Array<{
    key: string;
    desiredCount: number;
    existingCount: number;
    difference: number;
  }> = [];
  for (const bucket of buckets.values()) {
    const inspected = await db.$transaction((tx) =>
      inspectCustomerJoinEvent(tx, bucket.lead, bucket.businessDate),
    );
    if (inspected.difference !== 0) differences.push({ key: bucket.key, ...inspected });
  }

  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", checkedBuckets: buckets.size, differences }, null, 2));
    return;
  }

  for (const item of differences) {
    const bucket = buckets.get(item.key);
    if (!bucket) continue;
    await db.$transaction((tx) =>
      reconcileCustomerJoinEvent(tx, bucket.lead, bucket.businessDate),
    );
  }

  const remaining = [];
  for (const item of differences) {
    const bucket = buckets.get(item.key);
    if (!bucket) continue;
    const inspected = await db.$transaction((tx) =>
      inspectCustomerJoinEvent(tx, bucket.lead, bucket.businessDate),
    );
    if (inspected.difference !== 0) remaining.push({ key: bucket.key, ...inspected });
  }
  console.log(JSON.stringify({
    mode: "apply",
    checkedBuckets: buckets.size,
    correctedBuckets: differences.length,
    remaining,
  }, null, 2));
  if (remaining.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
