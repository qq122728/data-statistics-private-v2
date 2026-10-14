import { Prisma } from "@prisma/client";
import { db } from "./db";
import { normalizeCustomerPhone } from "./entry-ledger";

export type CurrentInGroupCustomer = {
  groupId: string;
  channel: { id: string; name: string; normalizedName: string };
  member: { id: string; name: string };
  operatorId?: string | null;
};

type LegacySheetData = {
  intakeOn?: unknown;
  channelId?: unknown;
  joinedOn?: unknown;
  operatorId?: unknown;
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

async function loadLegacySheetCurrentInGroup(groupIds: string[], asOf: string): Promise<Array<CurrentInGroupCustomer & { phone: string }>> {
  if (!groupIds.length) return [];
  const where = Prisma.join(groupIds.map((groupId) => Prisma.sql`
    ("groupId" = ${groupId} OR "data" LIKE ${`%"__statisticsGroupId":"${groupId}"%`})
  `), " OR ");
  let rows: Array<{ groupId: string; ownerId: string; phone: string; data: string }>;
  try {
    rows = await db.$queryRaw<Array<{ groupId: string; ownerId: string; phone: string; data: string }>>(Prisma.sql`
      SELECT "groupId", "ownerId", "phone", "data" FROM "CustomerSheetRow"
      WHERE (${where}) AND "data" LIKE ${'%"joinedOn"%'}
    `);
  } catch (error) {
    // 新安装的数据库只使用 LeadCustomer，不会创建已退役的旧客户明细表。
    // 这时没有旧数据可合并，直接继续使用新版数据；不能让统计页面整体报错。
    if (error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2010"
      && /(?:no such table|relation .* does not exist).*CustomerSheetRow/i.test(error.message)) return [];
    throw error;
  }
  const parsed = rows.flatMap((row) => {
    try {
      const data = JSON.parse(row.data) as LegacySheetData;
      const groupId = typeof data.__statisticsGroupId === "string" && data.__statisticsGroupId
        ? data.__statisticsGroupId : row.groupId;
      if (!groupIds.includes(groupId) || !legacyRowIsInGroup(data, asOf)) return [];
      const channelId = typeof data.channelId === "string" ? data.channelId : "";
      const ownerId = typeof data.__statisticsOwnerId === "string" && data.__statisticsOwnerId
        ? data.__statisticsOwnerId : row.ownerId;
      return [{ groupId, channelGroupId: row.groupId, channelId, ownerId, phone: row.phone,
        operatorId: typeof data.operatorId === "string" ? data.operatorId : null }];
    } catch {
      return [];
    }
  });
  const [channels, people] = await Promise.all([
    db.channel.findMany({
      where: {
        id: { in: [...new Set(parsed.map((row) => row.channelId))] },
        groupId: { in: [...new Set(parsed.map((row) => row.channelGroupId))] },
      },
      select: { id: true, groupId: true, name: true, normalizedName: true },
    }),
    db.user.findMany({ where: { id: { in: [...new Set(parsed.map((row) => row.ownerId))] } }, select: { id: true, name: true } }),
  ]);
  const channelsById = new Map(channels.map((channel) => [JSON.stringify([channel.groupId, channel.id]), channel]));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return parsed.flatMap((row) => {
    const channel = channelsById.get(JSON.stringify([row.channelGroupId, row.channelId]));
    if (!channel) return [];
    return [{ groupId: row.groupId, phone: row.phone, channel, member: peopleById.get(row.ownerId) ?? { id: row.ownerId, name: "历史归属" }, operatorId: row.operatorId }];
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
 * 同一小组可以同时使用两张表，按号码后六位只排除已迁入新版的旧行。
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
      phone: true,
      currentGroupId: true,
      groupOperatorOwnerId: true,
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
  const legacyRows = await loadLegacySheetCurrentInGroup(groupIds, asOf);
  const legacyPhones = new Set<string>();
  for (const row of legacyRows) {
    try {
      legacyPhones.add(normalizeCustomerPhone(row.phone));
    } catch {
      // 旧表的异常号码无法用于跨表去重，仍保留这条客户记录。
    }
  }
  // 新表已有同号码的客户即代表迁移完成；即使后来退群，也不能让旧表
  // 未同步的“在群”状态重新出现。新表号码在数据库中全局唯一。
  const migratedRows = legacyPhones.size ? await db.leadCustomer.findMany({
    where: { phone: { in: [...legacyPhones] }, joinedOn: { not: null, lte: asOf } },
    select: { phone: true },
  }) : [];
  const migratedPhones = new Set(migratedRows.map((row) => row.phone));
  return [...rows.map((row) => ({
    groupId: row.currentGroupId ?? row.batch.groupId,
    channel: row.batch.channel,
    member: row.attributionOwner ?? row.owner,
    operatorId: row.groupOperatorOwnerId,
  })), ...legacyRows.filter((row) => {
    try {
      return !migratedPhones.has(normalizeCustomerPhone(row.phone));
    } catch {
      // 老表可能保留无法解析的历史号码；不要因单行脏数据隐藏其他客户。
      return true;
    }
  }).map(({ phone: _phone, ...row }) => row)];
}

export function countCurrentInGroup(
  rows: CurrentInGroupCustomer[],
  predicate: (row: CurrentInGroupCustomer) => boolean,
) {
  let count = 0;
  for (const row of rows) if (predicate(row)) count += 1;
  return count;
}
