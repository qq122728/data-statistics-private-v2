import type { PrismaClient } from "@prisma/client";
import type { SheetData } from "../../packages/customer-sheet/schema";
import { db } from "./db";
import { assessGroupLeave } from "./group-leave";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import { assignActionNumbers } from "./sheet-action-numbers";
import { syncNumberStatistics } from "./number-statistics";
import { syncCustomerGroupEvent } from "./customer-number-event-sync";

const SYSTEM_ACTOR_ID = "system:auto-group-leave";
const OLD_NOTE = "系统：在群超过14天自动退群";
const CORRECTED_NOTE = "系统：满14天后自动退群（正常退群）";

function misclassifiedSheetData(raw: string): SheetData | null {
  try {
    const data = JSON.parse(raw) as SheetData;
    if (data.__leftAutomatically !== true || data.abnormalLeft !== true
      || typeof data.joinedOn !== "string" || typeof data.abnormalLeftOn !== "string"
      || assessGroupLeave(data.joinedOn.slice(0, 10), data.abnormalLeftOn.slice(0, 10)).level !== "NORMAL") return null;
    return data;
  } catch {
    return null;
  }
}

async function candidates(client: PrismaClient) {
  const [rows, leads] = await Promise.all([
    client.customerSheetRow.findMany({
      where: { data: { contains: '"__leftAutomatically":true' } },
      select: { id: true, groupId: true, data: true },
    }),
    client.leadCustomer.findMany({
      where: { leftAutomatically: true, leftWithOrder: false, leftNote: OLD_NOTE, groupStatus: "LEFT", leftOn: { not: null } },
      select: { id: true, joinedOn: true, leftOn: true },
    }),
  ]);
  return {
    rows: rows.filter((row) => misclassifiedSheetData(row.data)),
    leads: leads.filter((lead) => assessGroupLeave(lead.joinedOn, lead.leftOn).level === "NORMAL"),
  };
}

export async function previewAutoLeaveClassificationRepair(client: PrismaClient = db) {
  const due = await candidates(client);
  return { legacy: due.rows.length, leads: due.leads.length };
}

/** Correct only system-created day-14+ abnormal exits; preserve every manual exit. */
export async function repairAutoLeaveClassification(client: PrismaClient = db) {
  const due = await candidates(client);
  if (due.rows.length) {
    await client.user.upsert({
      where: { id: SYSTEM_ACTOR_ID },
      create: { id: SYSTEM_ACTOR_ID, username: "__system_auto_group_leave__", name: "系统自动退群", role: "RECEPTION", active: false },
      update: {},
    });
  }
  let legacyUpdated = 0;
  const byGroup = new Map<string, typeof due.rows>();
  for (const row of due.rows) {
    const rows = byGroup.get(row.groupId) ?? [];
    rows.push(row);
    byGroup.set(row.groupId, rows);
  }

  for (const [sourceGroupId, rows] of byGroup) {
    const changed = await client.$transaction(async (tx) => {
      let count = 0;
      for (const candidate of rows) {
        const row = await tx.customerSheetRow.findUnique({ where: { id: candidate.id } });
        if (!row) continue;
        const previous = misclassifiedSheetData(row.data);
        if (!previous) continue;
        const data: SheetData = {
          ...previous,
          normalLeft: true,
          normalLeftOn: previous.abnormalLeftOn,
          abnormalLeft: false,
          abnormalLeftOn: null,
          status: "正常退群",
        };
        await assignActionNumbers(tx, sheetStatisticsGroup(row.groupId, data), data);
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
    legacyUpdated += changed;
  }

  let leadUpdated = 0;
  for (const candidate of due.leads) {
    const changed = await client.$transaction(async (tx) => {
      const lead = await tx.leadCustomer.findUnique({
        where: { id: candidate.id },
        include: { batch: { select: { groupId: true, channelId: true } } },
      });
      if (!lead || !lead.leftAutomatically || lead.leftWithOrder !== false || lead.leftNote !== OLD_NOTE
        || lead.groupStatus !== "LEFT" || assessGroupLeave(lead.joinedOn, lead.leftOn).level !== "NORMAL") return false;
      const groupId = lead.leaveQueueGroupId ?? lead.currentGroupId ?? lead.batch.groupId;
      const tracked = { ...lead, batch: { groupId, channelId: lead.batch.channelId } };
      await syncCustomerGroupEvent(tx, tracked, { businessDate: lead.leftOn!, kind: "ABNORMAL_LEAVE", delta: -1 });
      await syncCustomerGroupEvent(tx, tracked, { businessDate: lead.leftOn!, kind: "NORMAL_LEAVE" });
      await tx.leadCustomer.update({ where: { id: lead.id }, data: { leftNote: CORRECTED_NOTE } });
      return true;
    }, { timeout: 15000 });
    if (changed) leadUpdated += 1;
  }
  return { legacyUpdated, leadUpdated };
}
