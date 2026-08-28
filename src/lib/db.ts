import { PrismaClient, type Prisma } from "@prisma/client";
import { resolve } from "node:path";

export type BatchKey = {
  groupId: string;
  channelId: string;
  sourceDate: string;
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

export async function getOrCreateSourceBatch(
  key: BatchKey,
  client: Pick<PrismaClient, "sourceBatch" | "channel"> | Prisma.TransactionClient = db,
) {
  const channel = await client.channel.findUniqueOrThrow({
    where: { id_groupId: { id: key.channelId, groupId: key.groupId } },
    select: { channelType: true },
  });
  const uniqueKey = {
    groupId: key.groupId,
    channelId: key.channelId,
    sourceDate: key.sourceDate,
  };
  const existing = await client.sourceBatch.findUnique({
    where: { groupId_channelId_sourceDate: uniqueKey },
    select: { id: true },
  });
  // 同一个渠道、同一天就是同一笔来源：允许多位接粉员共同导入到同一批次。
  if (existing) return client.sourceBatch.findUniqueOrThrow({ where: { id: existing.id } });
  return client.sourceBatch.upsert({
    where: {
      groupId_channelId_sourceDate: uniqueKey,
    },
    update: {},
    create: {
      ...uniqueKey,
      channelTypeSnapshot: channel.channelType,
    },
  });
}
