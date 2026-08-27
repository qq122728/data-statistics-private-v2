"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import type { ChannelDetail } from "../../../lib/analytics/channel-analysis";
import { Drawer } from "../../ui/Drawer";
import { FunnelSummary } from "../FunnelSummary";
import { MaturityWindowCards } from "../MaturityWindowCards";
import { formatUsdOr } from "../../../lib/money";

const percent = (value: number | null) => value === null ? "分母为 0" : `${(value * 100).toFixed(1)}%`;
const money = (cents: number | null) => formatUsdOr(cents, "分母为 0");

export function ChannelDetailDrawer({ detail, filters, showBatchLink = true }: { detail: ChannelDetail | null; filters: Partial<AnalysisFilters>; showBatchLink?: boolean }) {
  const router = useRouter();
  const closeHref = buildAnalysisHref("/channel-analysis", filters, { normalizedName: undefined });
  return <Drawer title={detail ? `${detail.displayName} · 渠道详情` : "渠道详情"} open={Boolean(detail)} onClose={() => router.replace(closeHref)} className="max-w-xl">{detail ? <div className="space-y-6 p-5">
    <section><h3 className="font-semibold">质量补充指标</h3><div className="analysis-detail-grid mt-3"><p className="rounded-lg bg-slate-50 p-3 text-sm">回复率<strong className="mt-1 block text-lg">{percent(detail.replyRate)}</strong></p><p className="rounded-lg bg-slate-50 p-3 text-sm">异常退群率<strong className="mt-1 block text-lg">{percent(detail.row.rates.leaveRate)}</strong></p><p className="rounded-lg bg-slate-50 p-3 text-sm">推专家率<strong className="mt-1 block text-lg">{percent(detail.row.rates.expertRate)}</strong></p><p className="rounded-lg bg-slate-50 p-3 text-sm">每开单入金<strong className="mt-1 block text-lg">{money(detail.rechargePerOrderCents)}</strong></p></div></section>
    <section><h3 className="mb-3 font-semibold">完整漏斗</h3><FunnelSummary totals={detail.row.totals} rates={detail.row.rates} /></section>
    <section><h3 className="mb-3 font-semibold">D7 / D14 累计</h3><MaturityWindowCards d7={detail.d7} d14={detail.d14} /></section>
    <section><h3 className="font-semibold">涉及小组</h3><p className="mt-2 text-sm text-slate-600">{detail.row.groups.join("、") || "暂无"}</p></section>
    {showBatchLink ? <Link className="inline-flex font-semibold text-[#0b66ff]" href={buildAnalysisHref("/batch-tracking", filters, { normalizedName: detail.normalizedName })}>查看相关批次</Link> : null}
  </div> : null}</Drawer>;
}
