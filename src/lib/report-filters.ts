import type { Prisma } from "@prisma/client";
import { normalizeChannelName } from "./channel-names";

export type ReportChannel = {
  id: string;
  name: string;
  normalizedName: string;
  active: boolean;
  groupId: string;
};

export type ChannelFilterOption = {
  normalizedName: string;
  name: string;
  active: boolean;
};

type ChannelFilterValues = {
  groupId?: string;
  channelId?: string;
  channelName?: string;
  normalizedName?: string;
};

export function resolveChannelFilterSelection(channels: ReportChannel[], values: ChannelFilterValues): {
  normalizedName: string | undefined;
  unresolvedLegacyChannelId: string | undefined;
  blockResults: boolean;
} {
  const explicitName = values.normalizedName ?? values.channelName;
  if (explicitName) {
    return { normalizedName: normalizeChannelName(explicitName), unresolvedLegacyChannelId: undefined, blockResults: false };
  }
  if (!values.channelId) {
    return { normalizedName: undefined, unresolvedLegacyChannelId: undefined, blockResults: false };
  }

  const normalizedNames = new Set(channels
    .filter((channel) => channel.id === values.channelId && (!values.groupId || channel.groupId === values.groupId))
    .map((channel) => normalizeChannelName(channel.normalizedName)));
  if (normalizedNames.size === 1) {
    return { normalizedName: [...normalizedNames][0], unresolvedLegacyChannelId: undefined, blockResults: false };
  }
  return { normalizedName: undefined, unresolvedLegacyChannelId: values.channelId, blockResults: true };
}

export function buildChannelFilterOptions(channels: ReportChannel[], groupId?: string): ChannelFilterOption[] {
  const grouped = new Map<string, ChannelFilterOption>();
  for (const channel of channels) {
    if (groupId && channel.groupId !== groupId) continue;
    const normalizedName = normalizeChannelName(channel.normalizedName);
    const current = grouped.get(normalizedName);
    if (!current || (!current.active && channel.active)) {
      grouped.set(normalizedName, { normalizedName, name: channel.name.trim(), active: channel.active });
    }
  }
  return [...grouped.values()].sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, "zh-CN"));
}

type RecentActivityFilterInput = {
  groupIds: string[];
  memberId?: string;
  channelId?: string;
  normalizedName?: string;
  sourceDateFrom?: string;
  sourceDateTo?: string;
  occurredDateFrom?: string;
  occurredDateTo?: string;
  today?: string;
};

const range = (from?: string, to?: string) => from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

export function buildRecentActivityFilters(input: RecentActivityFilterInput): Prisma.MetricEventWhereInput {
  const sourceDate = range(input.sourceDateFrom, input.sourceDateTo);
  const occurredDateTo = input.today && (!input.occurredDateTo || input.occurredDateTo > input.today) ? input.today : input.occurredDateTo;
  const occurredOn = range(input.occurredDateFrom, occurredDateTo);
  const normalizedName = input.normalizedName ? normalizeChannelName(input.normalizedName) : undefined;
  return {
    ...(input.memberId ? { enteredById: input.memberId } : {}),
    ...(occurredOn ? { occurredOn } : {}),
    batch: {
      groupId: { in: input.groupIds },
      ...(sourceDate ? { sourceDate } : {}),
      ...(normalizedName ? { channel: { normalizedName } } : input.channelId ? { channelId: input.channelId } : {}),
    },
  };
}
