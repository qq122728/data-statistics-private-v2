import type { Prisma } from "@prisma/client";

export type CustomerStageNumberKind = "GROUP" | "EXPERT";

/**
 * 在数据库里原子取得小组的下一个阶段编号。
 * upsert + increment 由数据库完成，因此两个人同时操作也不会取到同一个号码。
 */
export async function allocateCustomerStageNumber(
  transaction: Prisma.TransactionClient,
  groupId: string,
  kind: CustomerStageNumberKind,
) {
  const sequence = await transaction.customerStageSequence.upsert({
    where: { groupId },
    create: {
      groupId,
      lastGroupNumber: kind === "GROUP" ? 1 : 0,
      lastExpertNumber: kind === "EXPERT" ? 1 : 0,
    },
    update: kind === "GROUP"
      ? { lastGroupNumber: { increment: 1 } }
      : { lastExpertNumber: { increment: 1 } },
    select: { lastGroupNumber: true, lastExpertNumber: true },
  });
  return kind === "GROUP" ? sequence.lastGroupNumber : sequence.lastExpertNumber;
}

export function parseCustomerStageNumberQuery(query: string) {
  const match = query.trim().toUpperCase().match(/^([GE])[-\s]?0*(\d+)$/);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return match[1] === "G"
    ? { groupQueueNumber: value }
    : { expertQueueNumber: value };
}

export function formatCustomerStageNumber(kind: CustomerStageNumberKind, value: number | null | undefined) {
  if (!value) return "—";
  return `${kind === "GROUP" ? "G" : "E"}-${String(value).padStart(3, "0")}`;
}
