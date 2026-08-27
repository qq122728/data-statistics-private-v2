import type { Prisma } from "@prisma/client";

export async function touchDailyEntryConfirmations(
  transaction: Prisma.TransactionClient,
  userId: string,
  businessDates: Iterable<string>,
): Promise<void> {
  const dates = [...new Set(businessDates)];
  if (!dates.length) return;
  await transaction.dailyEntryConfirmation.updateMany({
    where: { userId, businessDate: { in: dates } },
    data: { updatedAt: new Date() },
  });
}
