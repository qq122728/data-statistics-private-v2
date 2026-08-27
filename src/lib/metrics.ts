import { formatUsd } from "./money";

export type MetricKind =
  | "NEW_FANS"
  | "REPLIES"
  | "GROUP_JOIN"
  | "GROUP_LEAVE"
  | "ABNORMAL_GROUP_LEAVE"
  | "EXPERT_INTRO"
  | "REGISTRATION"
  | "ORDER"
  | "RECHARGE"
  | "EFFECTIVE_FANS"
  | "NO_NUMBER"
  | "DUPLICATE_FANS"
  | "WITHDRAWAL"
  | "CHANNEL_PERFORMANCE";

export type MetricEvent = {
  kind: MetricKind;
  quantity?: number | null;
  amountCents?: number | null;
  voidedAt?: Date | string | null;
};

export type BatchTotals = {
  newFans: number;
  replies: number;
  groupJoin: number;
  groupLeave: number;
  /** 1–8 天异常退群；正常和观察退群不进入退群率。 */
  abnormalGroupLeave?: number;
  inGroup: number;
  expertIntro: number;
  registration: number;
  orders: number;
  rechargeCents: number;
  effectiveFans: number;
  noNumber: number;
  duplicateFans: number;
  withdrawalCents: number;
  channelPerformanceCents: number;
};

export const metricKindLabels = {
  NEW_FANS: "添加数据",
  EFFECTIVE_FANS: "有效数据",
  NO_NUMBER: "无 WS 号码",
  DUPLICATE_FANS: "撞粉",
  REPLIES: "回复",
  GROUP_JOIN: "入群",
  GROUP_LEAVE: "退群",
  ABNORMAL_GROUP_LEAVE: "异常退群",
  EXPERT_INTRO: "推专家",
  REGISTRATION: "注册",
  ORDER: "开单",
  RECHARGE: "入金",
  WITHDRAWAL: "出金",
  CHANNEL_PERFORMANCE: "通道业绩",
} as const satisfies Record<MetricKind, string>;

const amountMetricKinds = new Set<MetricKind>(["RECHARGE", "WITHDRAWAL", "CHANNEL_PERFORMANCE"]);

export function formatMetricEventValue(event: MetricEvent): string {
  if (amountMetricKinds.has(event.kind)) {
    return formatUsd(event.amountCents ?? 0);
  }
  return String(event.quantity ?? 0);
}

export function emptyBatchTotals(): BatchTotals {
  return {
    newFans: 0,
    replies: 0,
    groupJoin: 0,
    groupLeave: 0,
    abnormalGroupLeave: 0,
    inGroup: 0,
    expertIntro: 0,
    registration: 0,
    orders: 0,
    rechargeCents: 0,
    effectiveFans: 0,
    noNumber: 0,
    duplicateFans: 0,
    withdrawalCents: 0,
    channelPerformanceCents: 0,
  };
}

export function addBatchTotals(target: BatchTotals, value: BatchTotals): BatchTotals {
  for (const key of Object.keys(target) as Array<keyof BatchTotals>)
    target[key] = (target[key] ?? 0) + (value[key] ?? 0);
  return target;
}

export type ConversionRates = {
  /** 回复 ÷ 有效数据 */
  replyRate?: number | null;
  /** 进群 ÷ 回复 */
  groupRate: number | null;
  /** 退群 ÷ 进群 */
  leaveRate: number | null;
  /** 推专家 ÷ 进群 */
  expertRate: number | null;
  /** 注册 ÷ 推专家 */
  registrationRate: number | null;
  /** 开单 ÷ 注册 */
  orderRate: number | null;
};

export type ChannelComparison = {
  group: { id: string; name: string };
  channel: { id: string; name: string };
  totals: BatchTotals;
  rates: ConversionRates;
};

const divideOrNull = (numerator: number, denominator: number) =>
  denominator === 0 ? null : numerator / denominator;

export function calculateBatchTotals(events: MetricEvent[]): BatchTotals {
  const totals = emptyBatchTotals();

  for (const event of events) {
    if (event.voidedAt) continue;
    const quantity = event.quantity ?? 0;

    switch (event.kind) {
      case "NEW_FANS":
        totals.newFans += quantity;
        break;
      case "REPLIES":
        totals.replies += quantity;
        break;
      case "GROUP_JOIN":
        totals.groupJoin += quantity;
        break;
      case "GROUP_LEAVE":
        totals.groupLeave += quantity;
        break;
      case "ABNORMAL_GROUP_LEAVE":
        totals.abnormalGroupLeave = (totals.abnormalGroupLeave ?? 0) + quantity;
        break;
      case "EXPERT_INTRO":
        totals.expertIntro += quantity;
        break;
      case "REGISTRATION":
        totals.registration += quantity;
        break;
      case "ORDER":
        totals.orders += quantity;
        break;
      case "RECHARGE":
        totals.rechargeCents += event.amountCents ?? 0;
        break;
      case "EFFECTIVE_FANS":
        totals.effectiveFans += quantity;
        break;
      case "NO_NUMBER":
        totals.noNumber += quantity;
        break;
      case "DUPLICATE_FANS":
        totals.duplicateFans += quantity;
        break;
      case "WITHDRAWAL":
        totals.withdrawalCents += event.amountCents ?? 0;
        break;
      case "CHANNEL_PERFORMANCE":
        totals.channelPerformanceCents += event.amountCents ?? 0;
        break;
    }
  }

  totals.inGroup = totals.groupJoin - totals.groupLeave;
  return totals;
}

export function calculateConversionRates(totals: BatchTotals): ConversionRates {
  return {
    replyRate: divideOrNull(totals.replies, totals.effectiveFans),
    groupRate: divideOrNull(totals.groupJoin, totals.replies),
    leaveRate: divideOrNull(totals.abnormalGroupLeave ?? 0, totals.groupJoin),
    expertRate: divideOrNull(totals.expertIntro, totals.groupJoin),
    registrationRate: divideOrNull(totals.registration, totals.expertIntro),
    orderRate: divideOrNull(totals.orders, totals.registration),
  };
}

export function calculateChannelComparisons(
  rows: {
    group: { id: string; name: string };
    channel: { id: string; name: string };
    totals: BatchTotals;
  }[],
): ChannelComparison[] {
  const totalsByChannel = new Map<
    string,
    {
      group: { id: string; name: string };
      channel: { id: string; name: string };
      totals: BatchTotals;
    }
  >();

  for (const row of rows) {
    const key = `${row.group.id}\0${row.channel.id}`;
    const current = totalsByChannel.get(key) ?? {
      group: row.group,
      channel: row.channel,
      totals: emptyBatchTotals(),
    };
    addBatchTotals(current.totals, row.totals);
    totalsByChannel.set(key, current);
  }

  return [...totalsByChannel.values()].map(({ group, channel, totals }) => ({
    group,
    channel,
    totals,
    rates: calculateConversionRates(totals),
  }));
}

export function formatConversionNote(
  numerator: number,
  denominator: number,
  denominatorLabel: string,
  resultLabel: string,
) {
  if (numerator <= 0 || denominator <= 0) return "暂无可计算备注";
  const raw = denominator / numerator;
  const value = Number.isInteger(raw) ? String(raw) : raw.toFixed(1).replace(/\.0$/, "");
  return `平均 ${value} 个${denominatorLabel}产生 1 个${resultLabel}`;
}

export function calculateNormalizedChannelComparisons(
  rows: {
    group: { id: string; name: string };
    channel: { id: string; name: string };
    totals: BatchTotals;
  }[],
): ChannelComparison[] {
  const grouped = new Map<string, {
    groups: Map<string, { id: string; name: string }>;
    channel: { id: string; name: string };
    totals: BatchTotals;
  }>();

  for (const row of rows) {
    const key = normalizeChannelName(row.channel.name);
    const current = grouped.get(key) ?? {
      groups: new Map(),
      channel: { id: key, name: row.channel.name.trim() },
      totals: emptyBatchTotals(),
    };
    current.groups.set(row.group.id, row.group);
    addBatchTotals(current.totals, row.totals);
    grouped.set(key, current);
  }

  return [...grouped.values()].map(({ groups, channel, totals }) => ({
    group: groups.size === 1 ? [...groups.values()][0] : { id: "multi", name: "多个小组" },
    channel,
    totals,
    rates: calculateConversionRates(totals),
  }));
}
import { normalizeChannelName } from "./channel-names";
