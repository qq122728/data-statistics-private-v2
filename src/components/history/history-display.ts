import type { HistoryGroup, HistoryMetricTotals } from "../../lib/history-groups";

export type HistoryRole = "ADMIN" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";

export type HistoryBatch = {
  id: string;
  sourceDate: string;
  group: { id: string; name: string };
  channel: { id: string; name: string };
};

export const historyMetricDisplay = [
  { field: "newFans", label: "添加数据" },
  { field: "effectiveFans", label: "有效数据" },
  { field: "noNumber", label: "无效粉" },
  { field: "duplicateFans", label: "撞粉" },
  { field: "replies", label: "回复" },
  { field: "groupJoin", label: "入群" },
  { field: "groupLeave", label: "退群" },
  { field: "expertIntro", label: "推专家" },
  { field: "registration", label: "注册" },
  { field: "order", label: "开单" },
  { field: "rechargeCents", label: "入金" },
  { field: "withdrawalCents", label: "出金" },
  { field: "channelPerformanceCents", label: "通道业绩" },
] as const satisfies ReadonlyArray<{ field: keyof HistoryMetricTotals; label: string }>;

export function formatHistoryMetric(field: keyof HistoryMetricTotals, value: number): string {
  return field === "rechargeCents" || field === "withdrawalCents" || field === "channelPerformanceCents"
    ? `$${(value / 100).toFixed(2)}`
    : String(value);
}

export function historyChannelKey(group: Pick<HistoryGroup, "batch">): string {
  return `${encodeURIComponent(group.batch.group.id)}:${encodeURIComponent(group.batch.channel.id)}`;
}

export function historyChannelLabel(group: Pick<HistoryGroup, "batch">): string {
  return `${group.batch.channel.name} · ${group.batch.group.name}`;
}
