import { PrismaClient, type Prisma } from "@prisma/client";
import { resolve } from "node:path";

export type BatchKey = {
  groupId: string;
  channelId: string;
  sourceDate: string;
  /** 投流批次当次广告消耗，单位分。只在首次建批次时保存。 */
  advertisingSpendCents?: number | null;
  /** 该次投放当前已成功导入的有效新号码数，用于计算统一单粉成本。 */
  advertisingFanCount?: number | null;
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl:
      process.env.DATABASE_URL ?? `file:${resolve(process.cwd(), "prisma/dev.db")}`,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

type AdvertisingBatchClient = Pick<PrismaClient, "sourceBatch" | "metricEvent"> | Prisma.TransactionClient;

/**
 * 投流批次可以由多位接粉员共同导入。这里始终以该批次全部“成功新建”的
 * 有效粉事件为准重算人数，所以三个人拿到的是同一个单粉成本。
 */
export async function refreshAdvertisingBatchCost(
  batchId: string,
  client: AdvertisingBatchClient = db,
) {
  const batch = await client.sourceBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      channelTypeSnapshot: true,
      advertisingSpendCents: true,
      advertisingFanCount: true,
      advertisingServiceFeeRateBps: true,
    },
  });
  if (!batch || batch.channelTypeSnapshot !== "ADS") return batch;

  const imported = await client.metricEvent.aggregate({
    where: { batchId, kind: "EFFECTIVE_FANS", derivedFromLedger: true, voidedAt: null },
    _sum: { quantity: true },
  });
  // 兼容历史批次：旧批次可能只有已保存的人数快照，没有逐笔导入事件。
  const importedCount = imported._sum.quantity ?? 0;
  const fanCount = importedCount > 0 ? importedCount : (batch.advertisingFanCount ?? 0);
  const serviceFeeRateBps = batch.advertisingServiceFeeRateBps ?? 1_500;
  const effectiveFanPriceCents = batch.advertisingSpendCents !== null && fanCount > 0
    ? Math.round(batch.advertisingSpendCents * (1 + serviceFeeRateBps / 10_000) / fanCount)
    : null;

  return client.sourceBatch.update({
    where: { id: batch.id },
    data: {
      advertisingFanCount: fanCount,
      advertisingServiceFeeRateBps: serviceFeeRateBps,
      effectiveFanPriceCentsSnapshot: effectiveFanPriceCents,
    },
  });
}

export async function getOrCreateSourceBatch(
  key: BatchKey,
  client: Pick<PrismaClient, "sourceBatch" | "channel"> | Prisma.TransactionClient = db,
) {
  const channel = await client.channel.findUniqueOrThrow({
    where: { id_groupId: { id: key.channelId, groupId: key.groupId } },
    select: { fanCostMode: true, effectiveFanPriceCents: true, channelType: true, rebateRateBps: true },
  });
  const advertisingSpendCents = key.advertisingSpendCents ?? null;
  const advertisingFanCount = key.advertisingFanCount ?? null;
  const uniqueKey = {
    groupId: key.groupId,
    channelId: key.channelId,
    sourceDate: key.sourceDate,
  };
  const existing = await client.sourceBatch.findUnique({
    where: { groupId_channelId_sourceDate: uniqueKey },
    select: { id: true, channelTypeSnapshot: true },
  });
  // 同一个投流渠道、同一天就是同一笔投放：允许多位接粉员共同导入，
  // 后续由 refreshAdvertisingBatchCost 汇总全批有效新增数并计算统一成本。
  if (existing) return client.sourceBatch.findUniqueOrThrow({ where: { id: existing.id } });
  const effectiveFanPriceCents = channel.channelType === "ADS" && advertisingSpendCents !== null
    ? (() => {
      if (!Number.isSafeInteger(advertisingSpendCents) || advertisingSpendCents < 0) throw new RangeError("广告消耗金额不正确");
      const fanCount = advertisingFanCount ?? 0;
      if (!Number.isInteger(fanCount) || fanCount < 0) throw new RangeError("投流粉数量不正确");
      // 广告消耗 × 115% ÷ 当次产粉数，四舍五入到分。
      return fanCount > 0 ? Math.round((advertisingSpendCents * 1.15) / fanCount) : null;
    })()
    : channel.effectiveFanPriceCents;
  return client.sourceBatch.upsert({
    where: {
      groupId_channelId_sourceDate: uniqueKey,
    },
    update: {},
    create: {
      ...uniqueKey,
      fanCostModeSnapshot: channel.fanCostMode,
      effectiveFanPriceCentsSnapshot: effectiveFanPriceCents,
      channelTypeSnapshot: channel.channelType,
      rebateRateBpsSnapshot: channel.rebateRateBps,
      advertisingSpendCents,
      advertisingFanCount,
      advertisingServiceFeeRateBps: channel.channelType === "ADS" ? 1500 : null,
    },
  });
}
