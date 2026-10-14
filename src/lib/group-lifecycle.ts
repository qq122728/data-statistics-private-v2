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
      ...(input.groupIds?.length ? { OR: [
        { currentGroupId: { in: input.groupIds } },
        { currentGroupId: null, batch: { groupId: { in: input.groupIds } } },
      ] } : {}),
    },
    select: { id: true },
  });
  if (!due.length) return { checkedThrough: cutoff, updated: 0 };
  let updated = 0;
  // 每位客户各自提交；大量历史客户补处理时不会撞上单个大事务的超时。
  // 中途失败后重新运行，只会处理仍在群的客户。
  for (const candidate of due) {
    const changed = await client.$transaction(async (tx) => {
      const lead = await tx.leadCustomer.findUnique({
        where: { id: candidate.id },
        select: {
          id: true, phone: true, ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true,
          currentGroupId: true, isHistoricalRecord: true, joinedOn: true, groupStatus: true, trackingArchivedAt: true,
          batch: { select: { groupId: true, channelId: true } },
          customerOrder: { select: { voidedAt: true } },
        },
      });
      if (!lead || lead.trackingArchivedAt || lead.groupStatus !== "JOINED" || !lead.joinedOn || lead.joinedOn > cutoff) return false;
      const groupId = lead.currentGroupId ?? lead.batch.groupId;
      if (input.groupIds?.length && !input.groupIds.includes(groupId)) return false;
      const result = await tx.leadCustomer.updateMany({
        where: { id: lead.id, trackingArchivedAt: null, groupStatus: "JOINED", joinedOn: { lte: cutoff } },
        data: {
          groupStatus: "LEFT", leftOn: input.today,
          leftAutomatically: true,
          leftWithOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
          leftNote: "系统：满14天后自动退群（正常退群）",
          ...(lead.isHistoricalRecord ? { historicalLeaveCounted: true } : {}),
        },
      });
      if (!result.count) return false;
      const leaveQueueNumber = await allocateCustomerStageNumber(tx, groupId, "LEAVE", input.today);
      await tx.leadCustomer.update({ where: { id: lead.id }, data: { leaveQueueNumber, leaveQueueGroupId: groupId } });
      await syncCustomerGroupEvent(tx, { ...lead, batch: { groupId, channelId: lead.batch.channelId } }, {
        businessDate: input.today,
        kind: "NORMAL_LEAVE",
      });
      return true;
    }, { timeout: 15000 });
    if (changed) updated += 1;
  }
  return { checkedThrough: cutoff, updated };
}
