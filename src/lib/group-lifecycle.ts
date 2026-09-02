import type { PrismaClient } from "@prisma/client";
import { db } from "./db";
import { allocateCustomerStageNumber } from "./customer-stage-number";
import { syncCustomerGroupEvent } from "./customer-number-event-sync";

const DAY_MS = 24 * 60 * 60 * 1000;

function dateStamp(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  if (!year || !month || !day || Number.isNaN(stamp)) throw new Error("Invalid business date");
  return stamp;
}

/** 第 15 天开始自动结束群周期；第 14 天仍算正常在群。 */
export function automaticLeaveCutoff(today: string) {
  return new Date(dateStamp(today) - 14 * DAY_MS).toISOString().slice(0, 10);
}

export async function autoMarkExpiredGroupMemberships(input: {
  today: string;
  groupIds?: string[];
  client?: PrismaClient;
}) {
  const client = input.client ?? db;
  const cutoff = automaticLeaveCutoff(input.today);
  const due = await client.leadCustomer.findMany({
    where: {
      trackingArchivedAt: null,
      groupStatus: "JOINED",
      joinedOn: { lte: cutoff },
      ...(input.groupIds?.length ? { batch: { groupId: { in: input.groupIds } } } : {}),
    },
    select: {
      id: true, phone: true, ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true,
      currentGroupId: true, isHistoricalRecord: true,
      batch: { select: { groupId: true, channelId: true } },
      customerOrder: { select: { voidedAt: true } },
    },
  });
  if (!due.length) return { checkedThrough: cutoff, updated: 0 };
  const updated = await client.$transaction(async (tx) => {
    let count = 0;
    for (const lead of due) {
      const groupId = lead.currentGroupId ?? lead.batch.groupId;
      const leaveQueueNumber = await allocateCustomerStageNumber(tx, groupId, "LEAVE", input.today);
      const result = await tx.leadCustomer.updateMany({
        where: { id: lead.id, trackingArchivedAt: null, groupStatus: "JOINED" },
        data: {
          groupStatus: "LEFT", leftOn: input.today, leaveQueueNumber, leaveQueueGroupId: groupId,
          leftAutomatically: true,
          leftWithOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
          leftNote: "系统：在群超过14天自动退群",
          ...(lead.isHistoricalRecord ? { historicalLeaveCounted: true } : {}),
        },
      });
      if (!result.count) continue;
      count += result.count;
      await syncCustomerGroupEvent(tx, { ...lead, batch: { groupId, channelId: lead.batch.channelId } }, {
        businessDate: input.today,
        kind: lead.customerOrder && !lead.customerOrder.voidedAt ? "NORMAL_LEAVE" : "ABNORMAL_LEAVE",
      });
    }
    return count;
  });
  return { checkedThrough: cutoff, updated };
}
