import type { Prisma, PrismaClient } from "@prisma/client";

type GlobalChannelClient = Pick<PrismaClient, "channel" | "teamGroup"> | Prisma.TransactionClient;

type ChannelTemplate = {
  id: string;
  name: string;
  normalizedName: string;
  active: boolean;
  createdById: string | null;
  channelType: "SMS" | "ADS" | "REBATE";
};

/**
 * The current database keeps a channel copy per group so existing batch and
 * reporting relations stay stable. These helpers make that storage detail
 * invisible to users: one catalog channel is copied to every group.
 */
export async function copyGlobalChannelsToGroup(
  client: GlobalChannelClient,
  groupId: string,
): Promise<number> {
  const existingChannels = await client.channel.findMany({
    select: {
      id: true,
      name: true,
      normalizedName: true,
      active: true,
      createdById: true,
      channelType: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const templates: ChannelTemplate[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const channel of existingChannels) {
    // Channel ids are shared by the per-group copies. Historical local data
    // can contain copies whose names drifted before rename propagation was
    // introduced. Copying one row per name would then repeat the same
    // (id, groupId) primary key in the new group. Keep the oldest canonical
    // copy for both identity and normalized name.
    if (seenIds.has(channel.id) || seenNames.has(channel.normalizedName)) continue;
    seenIds.add(channel.id);
    seenNames.add(channel.normalizedName);
    templates.push(channel);
  }
  if (!templates.length) return 0;
  const result = await client.channel.createMany({
    data: templates.map((channel) => ({ ...channel, groupId })),
  });
  return result.count;
}

export async function listGlobalChannelGroupIds(client: GlobalChannelClient): Promise<string[]> {
  const groups = await client.teamGroup.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  return groups.map((group) => group.id);
}

export function collapseGlobalChannelCopies<
  T extends { id: string; active: boolean; _count: { batches: number } },
>(rows: T[]): Array<{ row: T; groupCount: number; batchCount: number }> {
  const collapsed = new Map<string, { row: T; groupCount: number; batchCount: number }>();
  for (const row of rows) {
    const existing = collapsed.get(row.id);
    if (existing) {
      existing.groupCount += 1;
      existing.batchCount += row._count.batches;
      existing.row.active = existing.row.active && row.active;
    } else {
      collapsed.set(row.id, { row, groupCount: 1, batchCount: row._count.batches });
    }
  }
  return [...collapsed.values()];
}
