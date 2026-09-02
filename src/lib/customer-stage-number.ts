import type { Prisma } from "@prisma/client";

export type CustomerStageNumberKind = "GROUP" | "EXPERT" | "REGISTRATION" | "ORDER" | "LEAVE";

const stagePrefix: Record<CustomerStageNumberKind, "G" | "E" | "R" | "O" | "L"> = {
  GROUP: "G",
  EXPERT: "E",
  REGISTRATION: "R",
  ORDER: "O",
  LEAVE: "L",
};

/**
 * 在数据库里原子取得“小组 + 阶段 + 业务日期”的下一个编号。
 * upsert + increment 由数据库完成，因此两个人同时操作也不会取到同一个号码。
 */
export async function allocateCustomerStageNumber(
  transaction: Prisma.TransactionClient,
  groupId: string,
  kind: CustomerStageNumberKind,
  occurredOn: string,
) {
  const sequence = await transaction.customerDailyStageSequence.upsert({
    where: { groupId_kind_occurredOn: { groupId, kind, occurredOn } },
    create: { groupId, kind, occurredOn, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return sequence.lastNumber;
}

export function parseCustomerStageNumberQuery(query: string) {
  const normalized = query.trim().toUpperCase();
  const legacy = normalized.match(/^([GE])-0*(\d+)$/);
  if (legacy) {
    const value = Number(legacy[2]);
    return Number.isSafeInteger(value) && value > 0
      ? { prefix: legacy[1] as "G" | "E", month: null, day: null, value }
      : null;
  }
  const match = normalized.match(/^([GEROL])-(\d{1,2})-(\d{1,2})-(\d+)$/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = Number(match[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || !Number.isSafeInteger(value) || value < 1) return null;
  return { prefix: match[1] as "G" | "E" | "R" | "O" | "L", month, day, value };
}

export function formatCustomerStageNumber(kind: CustomerStageNumberKind, occurredOn: string | null | undefined, value: number | null | undefined) {
  if (!occurredOn || !value) return "—";
  const [, month, day] = occurredOn.split("-").map(Number);
  if (!month || !day) return "—";
  return `${stagePrefix[kind]}-${month}-${day}-${String(value).padStart(3, "0")}`;
}
