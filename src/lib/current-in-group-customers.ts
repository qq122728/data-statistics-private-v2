import type { Prisma } from "@prisma/client";
import { db } from "./db";

export type CurrentInGroupCustomer = {
  groupId: string;
  channel: { id: string; name: string; normalizedName: string };
  member: { id: string; name: string };
};

/**
 * 号码追踪启用后，“当前在群”以客户进度的真实状态为准。
 *
 * 日报里的 currentInGroupCount 只是一条业务线在某次操作后的快照；人员调动、
 * 历史号码归档或承载人变化后再把这些快照相加，会漏算或重复计算。这里直接按
 * 截止日重建真实存量，同时保留以前月份继续使用已封账日报的能力。
 */
export async function loadCurrentInGroupCustomers(
  groupIds: string[],
  asOf: string,
): Promise<CurrentInGroupCustomer[]> {
  if (!groupIds.length) return [];
  const currentGroupWhere: Prisma.LeadCustomerWhereInput = {
    OR: [
      { currentGroupId: { in: groupIds } },
      { currentGroupId: null, batch: { groupId: { in: groupIds } } },
    ],
  };
  const rows = await db.leadCustomer.findMany({
    where: {
      AND: [
        currentGroupWhere,
        { OR: [{ leftOn: null }, { leftOn: { gt: asOf } }] },
      ],
      invalid: false,
      trackingArchivedAt: null,
      joinedOn: { not: null, lte: asOf },
    },
    select: {
      currentGroupId: true,
      owner: { select: { id: true, name: true } },
      attributionOwner: { select: { id: true, name: true } },
      batch: {
        select: {
          groupId: true,
          channel: { select: { id: true, name: true, normalizedName: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    groupId: row.currentGroupId ?? row.batch.groupId,
    channel: row.batch.channel,
    member: row.attributionOwner ?? row.owner,
  }));
}

export function countCurrentInGroup(
  rows: CurrentInGroupCustomer[],
  predicate: (row: CurrentInGroupCustomer) => boolean,
) {
  let count = 0;
  for (const row of rows) if (predicate(row)) count += 1;
  return count;
}
