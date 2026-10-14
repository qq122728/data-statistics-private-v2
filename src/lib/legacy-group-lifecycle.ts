import type { PrismaClient } from "@prisma/client";
import type { SheetData } from "../../packages/customer-sheet/schema";
import { assignActionNumbers } from "./sheet-action-numbers";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import { syncNumberStatistics } from "./number-statistics";
import { db } from "./db";
import { automaticLeaveCutoff } from "./group-lifecycle";

const SYSTEM_ACTOR_ID = "system:auto-group-leave";

function dueSheetData(raw: string, cutoff: string): SheetData | null {
  try {
    const data = JSON.parse(raw) as SheetData;
    const joinedOn = typeof data.joinedOn === "string" ? data.joinedOn.slice(0, 10) : "";
    if (data.__deletedAt || !/^\d{4}-\d{2}-\d{2}$/.test(joinedOn) || joinedOn > cutoff
      || data.normalLeft === true || data.abnormalLeft === true) return null;
    return data;
  } catch {
    return null;
  }
}

async function dueSheetRows(client: PrismaClient, cutoff: string, groupIds?: string[]) {
  const rows = await client.customerSheetRow.findMany({
    where: { data: { contains: '"joinedOn"' } },
    select: { id: true, groupId: true, data: true },
  });
  return rows.filter((row) => {
    const data = dueSheetData(row.data, cutoff);
    return data && (!groupIds?.length || groupIds.includes(sheetStatisticsGroup(row.groupId, data)));
  });
}

export async function countExpiredLegacyGroupMemberships(input: {
  today: string;
  groupIds?: string[];
  client?: PrismaClient;
}) {
  return (await dueSheetRows(input.client ?? db, automaticLeaveCutoff(input.today), input.groupIds)).length;
}

/** 旧客户明细仍有人使用，必须与新版客户一起按第 15 天结束群周期。 */
export async function autoMarkExpiredLegacyGroupMemberships(input: {
  today: string;
  groupIds?: string[];
  client?: PrismaClient;
}) {
  const client = input.client ?? db;
  const cutoff = automaticLeaveCutoff(input.today);
  const due = await dueSheetRows(client, cutoff, input.groupIds);
  if (!due.length) return { checkedThrough: cutoff, updated: 0 };

  await client.user.upsert({
    where: { id: SYSTEM_ACTOR_ID },
    create: { id: SYSTEM_ACTOR_ID, username: "__system_auto_group_leave__", name: "系统自动退群", role: "RECEPTION", active: false },
    update: {},
  });

  const bySourceGroup = new Map<string, typeof due>();
  for (const row of due) {
    const groupRows = bySourceGroup.get(row.groupId) ?? [];
    groupRows.push(row);
    bySourceGroup.set(row.groupId, groupRows);
  }

  let updated = 0;
  for (const [sourceGroupId, candidates] of bySourceGroup) {
    const changed = await client.$transaction(async (tx) => {
      let count = 0;
      for (const candidate of candidates) {
        const row = await tx.customerSheetRow.findUnique({ where: { id: candidate.id } });
        if (!row) continue;
        const previous = dueSheetData(row.data, cutoff);
        if (!previous) continue;
        const groupId = sheetStatisticsGroup(row.groupId, previous);
        if (input.groupIds?.length && !input.groupIds.includes(groupId)) continue;

        const data: SheetData = {
          ...previous,
          normalLeft: true,
          normalLeftOn: input.today,
          abnormalLeft: false,
          abnormalLeftOn: null,
          status: "正常退群",
          __leftAutomatically: true,
        };
        await assignActionNumbers(tx, groupId, data);
        const after = JSON.stringify(data);
        const result = await tx.customerSheetRow.updateMany({
          where: { id: row.id, version: row.version },
          data: { data: after, version: { increment: 1 } },
        });
        if (!result.count) continue;
        await tx.customerSheetRevision.create({
          data: { rowId: row.id, version: row.version + 1, actorId: SYSTEM_ACTOR_ID, before: row.data, after },
        });
        count += 1;
      }
      if (count) await syncNumberStatistics(tx, sourceGroupId, SYSTEM_ACTOR_ID);
      return count;
    }, { timeout: 120000 });
    updated += changed;
  }
  return { checkedThrough: cutoff, updated };
}
