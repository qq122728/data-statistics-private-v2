import type { BatchTotals, ConversionRates } from "../../lib/metrics";
import type { FunnelDrop } from "../../lib/analytics/overview";

const percent = (value: number | null) => value === null ? "分母为 0" : `${(value * 100).toFixed(1)}%`;
const names = { NEW_FANS: "添加数据", REPLIES: "回复", GROUP_JOIN: "进群", EXPERT_INTRO: "推专家", REGISTRATION: "注册", ORDER: "开单" } as const;

export function FunnelSummary({ totals, rates, largestDrop }: { totals: BatchTotals; rates: ConversionRates; largestDrop?: FunnelDrop | null }) {
  const stages = [
    ["添加数据", totals.newFans, null], ["回复", totals.replies, rates.replyRate ?? null], ["进群", totals.groupJoin, rates.groupRate],
    ["推专家", totals.expertIntro, rates.expertRate], ["注册", totals.registration, rates.registrationRate], ["开单", totals.orders, rates.orderRate],
  ] as const;
  return <section className="space-y-3"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{stages.map(([label, value, rate]) => <article key={label} className="rounded-lg border border-slate-200 p-3"><p className="text-sm text-slate-500">{label}</p><strong className="mt-1 block text-lg">{value}</strong>{rate !== null || label !== "添加数据" ? <span className="text-xs text-slate-400">{percent(rate)}</span> : null}</article>)}</div>{largestDrop ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">最大掉点：{names[largestDrop.from]} → {names[largestDrop.to]}，流失 {largestDrop.lost}</p> : null}</section>;
}
