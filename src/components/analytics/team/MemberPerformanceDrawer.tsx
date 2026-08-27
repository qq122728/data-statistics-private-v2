"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import type { MemberPerformanceDetail } from "../../../lib/analytics/team-performance";
import { calculateConversionRates } from "../../../lib/metrics";
import { Drawer } from "../../ui/Drawer";
import { FunnelSummary } from "../FunnelSummary";
import { formatUsd as money } from "../../../lib/money";

export function MemberPerformanceDrawer({ detail, filters }: { detail: MemberPerformanceDetail | null; filters: Partial<AnalysisFilters> }) {
  const router = useRouter();
  const closeHref = buildAnalysisHref("/team-performance", filters, { memberId: undefined });
  return <Drawer title={detail ? `${detail.row.name} · 人员详情` : "人员详情"} open={Boolean(detail)} onClose={() => router.replace(closeHref)} className="max-w-xl">
    {detail ? <div className="space-y-6 p-5">
      <section><h3 className="font-semibold">核心结果</h3><div className="analysis-detail-grid mt-3"><p className="rounded-lg bg-slate-50 p-3 text-sm">添加数据<strong className="mt-1 block text-lg">{detail.row.totals.newFans}</strong></p><p className="rounded-lg bg-slate-50 p-3 text-sm">开单<strong className="mt-1 block text-lg">{detail.row.totals.orders}</strong></p><p className="rounded-lg bg-slate-50 p-3 text-sm">入金<strong className="mt-1 block text-lg">{money(detail.row.totals.rechargeCents)}</strong></p></div></section>
      <section><h3 className="mb-3 font-semibold">完整漏斗与最大掉点</h3><FunnelSummary totals={detail.row.totals} rates={calculateConversionRates(detail.row.totals)} largestDrop={detail.largestDrop} /></section>
      <section><h3 className="font-semibold">最近趋势</h3><div className="mt-2 space-y-2">{detail.trend.slice(-7).map((point) => <p key={point.occurredOn} className="flex justify-between text-sm text-slate-600"><span>{point.occurredOn}</span><span>添加数据 {point.newFans} · 开单 {point.orders} · {money(point.rechargeCents)}</span></p>)}</div></section>
      <section><h3 className="font-semibold">渠道构成</h3><div className="mt-2 space-y-2">{detail.channelComposition.map((channel) => <p key={channel.normalizedName} className="flex justify-between text-sm"><span>{channel.displayName}</span><span>添加数据 {channel.newFans} · 开单 {channel.orders}</span></p>)}</div></section>
      <Link className="inline-flex font-semibold text-[#0b66ff]" href={buildAnalysisHref("/batch-tracking", filters, { memberId: detail.row.userId })}>查看相关批次</Link>
    </div> : null}
  </Drawer>;
}
