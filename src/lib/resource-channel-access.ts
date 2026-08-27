export type ResourceChannelType = "SMS" | "ADS" | "REBATE";

export type ResourceChannelCatalogItem = {
  id: string;
  channelType: ResourceChannelType;
};

export function getResourceChannelTypes(
  channels: ResourceChannelCatalogItem[],
  assignedChannelIds: Iterable<string>,
): ResourceChannelType[] {
  const assigned = new Set(assignedChannelIds);
  return [...new Set(
    channels
      .filter((channel) => assigned.has(channel.id))
      .map((channel) => channel.channelType),
  )];
}

export function expandResourceChannelIdsByType(
  channels: ResourceChannelCatalogItem[],
  assignedChannelIds: Iterable<string>,
): string[] {
  const allowedTypes = new Set(getResourceChannelTypes(channels, assignedChannelIds));
  return [...new Set(
    channels
      .filter((channel) => allowedTypes.has(channel.channelType))
      .map((channel) => channel.id),
  )];
}
