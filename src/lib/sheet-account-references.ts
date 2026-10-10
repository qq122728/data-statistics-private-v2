import type { Prisma } from "@prisma/client";

/** Customer JSON references have no foreign keys. Shared locks permit normal customer
 * writes concurrently; account deletion takes the exclusive counterpart before reading.
 * SQLite already serializes writes and rejects stale write snapshots. */
export async function lockSheetAccountReferences(tx: Prisma.TransactionClient, deletingAccount = false) {
  if (process.env.DATABASE_PROVIDER !== "postgresql") return;
  if (deletingAccount) await tx.$queryRaw`SELECT pg_advisory_xact_lock(73142, 1)::text`;
  else await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(73142, 1)::text`;
}

export class SheetReferenceIntegrityError extends Error {
  constructor() {
    super("客户或资金历史资料格式异常，暂时不能删除账号；请先核对资料，或改为停用账号");
  }
}

function parseReferenceJson(serialized: string) {
  try { return JSON.parse(serialized); }
  catch { throw new SheetReferenceIntegrityError(); }
}

export function sheetDataReferencesUser(serialized: string, userId: string): boolean {
  const data = parseReferenceJson(serialized);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new SheetReferenceIntegrityError();
  if ([data.ownerId, data.operatorId, data.expertId, data.__statisticsOwnerId, data.__deletedBy].includes(userId)) return true;
  if (data.__recharges) {
    const entries = parseReferenceJson(data.__recharges);
    if (!Array.isArray(entries)) throw new SheetReferenceIntegrityError();
    if (entries.some(entry => entry?.actorId === userId)) return true;
  }
  return false;
}

export async function hasSheetUserReferences(tx: Prisma.TransactionClient, userId: string) {
  // Parse exact JSON values (including archived rows), never infer a reference from
  // substring/name matching. Page both tables to bound memory for historical revisions.
  let cursor: string | undefined;
  while (true) {
    const rows: {id:string;ownerId:string;data:string}[] = await tx.customerSheetRow.findMany({ take: 500, ...(cursor ? {cursor:{id:cursor},skip:1} : {}), orderBy:{id:"asc"}, select:{id:true,ownerId:true,data:true} });
    if (rows.some(row => row.ownerId === userId || sheetDataReferencesUser(row.data,userId))) return true;
    if (rows.length < 500) break;
    cursor = rows.at(-1)!.id;
  }
  cursor = undefined;
  while (true) {
    const rows: {id:string;actorId:string;before:string;after:string}[] = await tx.customerSheetRevision.findMany({ take: 500, ...(cursor ? {cursor:{id:cursor},skip:1} : {}), orderBy:{id:"asc"}, select:{id:true,actorId:true,before:true,after:true} });
    if (rows.some(row => row.actorId === userId || sheetDataReferencesUser(row.before,userId) || sheetDataReferencesUser(row.after,userId))) return true;
    if (rows.length < 500) return false;
    cursor = rows.at(-1)!.id;
  }
}
