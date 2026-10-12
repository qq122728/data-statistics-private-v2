import type { ChannelType, Prisma, PrismaClient } from "@prisma/client";

type ScopeClient = Pick<PrismaClient, "user" | "resourceChannelAccess"> | Prisma.TransactionClient;

/** New type-wide resource accounts receive each new channel in their category. */
export async function grantResourceChannelTypeScope(
  client: ScopeClient,
  channelId: string,
  channelType: ChannelType,
) {
  if (channelType !== "ADS" && channelType !== "SMS") return;
  const accounts = await client.user.findMany({
    where: { role: "RESOURCE_MANAGER", resourceChannelTypeScope: channelType },
    select: { id: true },
  });
  for (const account of accounts) {
    await client.resourceChannelAccess.upsert({
      where: { userId_channelId: { userId: account.id, channelId } },
      update: {},
      create: { userId: account.id, channelId },
    });
  }
}
