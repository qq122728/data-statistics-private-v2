import type { PrismaClient } from "@prisma/client";
import type { SheetData } from "../../packages/customer-sheet/schema";
import { db } from "./db";
import { assignActionNumbers } from "./sheet-action-numbers";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import { syncNumberStatistics } from "./number-statistics";

const SYSTEM_ACTOR_ID = "system:auto-registration";

function missingRegistration(raw: string): { data: SheetData; date: string } | null {
  let data: SheetData;
  try { data = JSON.parse(raw) as SheetData; } catch { return null; }
  if (data.__deletedAt || Number(data.firstDeposit) <= 0 || data.registeredOn) return null;
  const date = String(data.firstDepositOn ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
  if ([data.intakeOn, data.joinedOn, data.expertOn, data.traceStartedOn, data.invitedOn]
    .some((earlier) => earlier && String(earlier).slice(0, 10) > date)) return null;
  return { data, date };
}

export async function previewRegistrationBackfill(client: PrismaClient = db) {
  const rows = await client.customerSheetRow.findMany({ select: { id: true, data: true } });
  const missing = rows.filter((row) => {
    try {
      const data = JSON.parse(row.data) as SheetData;
      return !data.__deletedAt && Number(data.firstDeposit) > 0 && !data.registeredOn;
    } catch { return false; }
  });
  return { eligible: missing.filter((row) => missingRegistration(row.data)).length, needsReview: missing.filter((row) => !missingRegistration(row.data)).length };
}

/** Repair legacy customer rows with an auditable revision, then rebuild their number reports. */
export async function backfillRegistrationFromDeposit(client: PrismaClient = db) {
  const rows = await client.customerSheetRow.findMany({ select: { id: true, groupId: true, data: true } });
  const byGroup = new Map<string, string[]>();
  for (const row of rows) {
    if (!missingRegistration(row.data)) continue;
    const ids = byGroup.get(row.groupId) ?? [];
    ids.push(row.id);
    byGroup.set(row.groupId, ids);
  }
  if (byGroup.size) await client.user.upsert({
    where: { id: SYSTEM_ACTOR_ID },
    create: { id: SYSTEM_ACTOR_ID, username: "__system_auto_registration__", name: "系统自动补注册", role: "RECEPTION", active: false },
    update: {},
  });

  let updated = 0;
  for (const [groupId, ids] of byGroup) {
    updated += await client.$transaction(async (tx) => {
      let changed = 0;
      for (const id of ids) {
        const row = await tx.customerSheetRow.findUnique({ where: { id } });
        if (!row) continue;
        const missing = missingRegistration(row.data);
        if (!missing) continue;
        const next: SheetData = { ...missing.data, registeredOn: missing.date };
        await assignActionNumbers(tx, sheetStatisticsGroup(groupId, next), next);
        const after = JSON.stringify(next);
        const saved = await tx.customerSheetRow.updateMany({
          where: { id, version: row.version },
          data: { data: after, version: { increment: 1 } },
        });
        if (!saved.count) continue;
        await tx.customerSheetRevision.create({
          data: { rowId: id, version: row.version + 1, actorId: SYSTEM_ACTOR_ID, before: row.data, after },
        });
        changed += 1;
      }
      if (changed) await syncNumberStatistics(tx, groupId, SYSTEM_ACTOR_ID);
      return changed;
    }, { timeout: 180000 });
  }
  return { updated };
}
