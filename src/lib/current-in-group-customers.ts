import { Prisma } from "@prisma/client";
import { db } from "./db";

export type CurrentInGroupCustomer = {
  groupId: string;
  channel: { id: string; name: string; normalizedName: string };
  member: { id: string; name: string };
};

type LegacySheetData = {
  intakeOn?: unknown;
  channelId?: unknown;
  joinedOn?: unknown;
  normalLeft?: unknown;
  normalLeftOn?: unknown;
  abnormalLeft?: unknown;
  abnormalLeftOn?: unknown;
  __deletedAt?: unknown;
  __statisticsGroupId?: unknown;
  __statisticsOwnerId?: unknown;
};

function dateOf(value: unknown) {
  const date = typeof value === "string" ? value.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function legacyRowIsInGroup(data: LegacySheetData, asOf: string) {
  const joinedOn = dateOf(data.joinedOn);
  if (data.__deletedAt || !dateOf(data.intakeOn) || !data.channelId || !joinedOn || joinedOn > asOf) return false;
  const normalLeftOn = dateOf(data.normalLeftOn);
  const abnormalLeftOn = dateOf(data.abnormalLeftOn);
  return !(data.normalLeft === true && normalLeftOn && normalLeftOn <= asOf)
    && !(data.abnormalLeft === true && abnormalLeftOn && abnormalLeftOn <= asOf);
}

async function loadLegacySheetCurrentInGroup(groupIds: string[], asOf: string): Promise<CurrentInGroupCustomer[]> {
  if (!groupIds.length) return [];
  const where = Prisma.join(groupIds.map((groupId) => Prisma.sql`
    ("groupId" = ${groupId} OR "data" LIKE ${`%"__statisticsGroupId":"${groupId}"%`})
  `), " OR ");
  const rows = await db.$queryRaw<Array<{ groupId: string; ownerId: string; data: string }>>(Prisma.sql`
    SELECT "groupId", "ownerId", "data" FROM "CustomerSheetRow" WHERE ${where}
  `);
  const parsed = rows.flatMap((row) => {
    try {
      const data = JSON.parse(row.data) as LegacySheetData;
      const groupId = typeof data.__statisticsGroupId === "string" && data.__statisticsGroupId
        ? data.__statisticsGroupId : row.groupId;
      if (!groupIds.includes(groupId) || !legacyRowIsInGroup(data, asOf)) return [];
      const channelId = typeof data.channelId === "string" ? data.channelId : "";
      const ownerId = typeof data.__statisticsOwnerId === "string" && data.__statisticsOwnerId
        ? data.__statisticsOwnerId : row.ownerId;
      return [{ groupId, channelId, ownerId }];
    } catch {
      return [];
    }
  });
  const [channels, people] = await Promise.all([
    db.channel.findMany({ where: { id: { in: [...new Set(parsed.map((row) => row.channelId))] } }, select: { id: true, name: true, normalizedName: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(parsed.map((row) => row.ownerId))] } }, select: { id: true, name: true } }),
  ]);
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return parsed.flatMap((row) => {
    const channel = channelsById.get(row.channelId);
    if (!channel) return [];
    return [{ groupId: row.groupId, channel, member: peopleById.get(row.ownerId) ?? { id: row.ownerId, name: "历史归属" } }];
  });
}

/**
 * 号码追踪启用后，“当前在群”以客户进度的真实状态为准。
 *
 * 日报里的 currentInGroupCount 只是一条业务线在某次操作后的快照；人员调动、
 * 历史号码归档或承载人变化后再把这些快照相加，会漏算或重复计算。这里直接按
 * 截止日重建真实存量，同时保留以前月份继续使用已封账日报的能力。
 *
 * 有些已在用小组的号码仍保存在旧客户明细表，尚未迁入 LeadCustomer。
 * 这类小组不能因为新版表为空就被误报为“当前在群 0”；每个小组优先读
 * 新表，只要该组尚无任何新表客户便回退到旧明细表。两份来源绝不混加。
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
  // 迁移过程中有些小组只产生过少量新版测试记录，但当前在群客户仍全部
  // 留在旧明细。只有新版表实际查到当前在群客户时，才把它作为该小组的来源。
  // 否则继续使用旧明细，避免“小组有一条新版记录”就把旧存量错误清零。
  const groupsWithCurrentTrackedCustomers = new Set(rows.map((row) => row.currentGroupId ?? row.batch.groupId));
  const legacyRows = await loadLegacySheetCurrentInGroup(
    groupIds.filter((groupId) => !groupsWithCurrentTrackedCustomers.has(groupId)),
    asOf,
  );
  return [...rows.map((row) => ({
    groupId: row.currentGroupId ?? row.batch.groupId,
    channel: row.batch.channel,
    member: row.attributionOwner ?? row.owner,
  })), ...legacyRows];
}

export function countCurrentInGroup(
  rows: CurrentInGroupCustomer[],
  predicate: (row: CurrentInGroupCustomer) => boolean,
) {
  let count = 0;
  for (const row of rows) if (predicate(row)) count += 1;
  return count;
}
