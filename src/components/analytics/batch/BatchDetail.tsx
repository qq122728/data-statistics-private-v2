import Link from "next/link";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import type { BatchDetail as BatchDetailData } from "../../../lib/analytics/batch-tracking";
import { formatMetricEventValue, metricKindLabels } from "../../../lib/metrics";
import { FunnelSummary } from "../FunnelSummary";
import { MaturityWindowCards } from "../MaturityWindowCards";
import { formatUsd as money } from "../../../lib/money";
import { AdvertisingSpendEditor } from "./AdvertisingSpendEditor";

export function BatchDetail({ detail, filters, canEditAdvertisingSpend }: { detail: BatchDetailData; filters: Partial<AnalysisFilters>; canEditAdvertisingSpend: boolean }) {
  const historyHref = buildAnalysisHref("/history", filters, { sourceDateFrom: detail.sourceDate, sourceDateTo: detail.sourceDate, memberId: detail.memberId, normalizedName: detail.normalizedName });
  return <div className="space-y-4">
    <section className="panel p-5"><h2 className="panel-title">批次身份</h2><dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-sm text-slate-500">来源日期</dt><dd className="mt-1 font-semibold">{detail.sourceDate} · {detail.ageLabel}</dd></div><div><dt className="text-sm text-slate-500">渠道</dt><dd className="mt-1 font-semibold">{detail.channelName}</dd></div><div><dt className="text-sm text-slate-500">人员</dt><dd className="mt-1 font-semibold">{detail.memberName}</dd></div><div><dt className="text-sm text-slate-500">小组</dt><dd className="mt-1 font-semibold">{detail.groupName}</dd></div></dl></section>
    {detail.channelType === "ADS" ? <AdvertisingSpendEditor batchId={detail.batchId} advertisingSpendCents={detail.advertisingSpendCents} advertisingFanCount={detail.advertisingFanCount} advertisingServiceFeeRateBps={detail.advertisingServiceFeeRateBps} effectiveFanPriceCentsSnapshot={detail.effectiveFanPriceCentsSnapshot} canEdit={canEditAdvertisingSpend} /> : null}
    <section className="panel p-5"><h2 className="mb-4 panel-title">完整漏斗</h2><FunnelSummary totals={detail.totals} rates={detail.rates} largestDrop={detail.largestDrop} /></section>
    <MaturityWindowCards d7={detail.d7} d14={detail.d14} />
    <section className="panel">
      <div className="panel-header">
        <div><h2 className="panel-title">批次客户明细</h2><p className="panel-subtitle">直接核对具体手机号、当前阶段和现在由谁负责</p></div>
        <Link className="text-sm font-semibold text-[#0b66ff]" href={historyHref}>查看完整客户记录</Link>
      </div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>手机号 / 姓名</th><th>当前阶段</th><th>当前负责人</th><th>群状态</th><th>下一步计划</th></tr></thead><tbody>
        {detail.customers.map((customer) => <tr key={customer.id}><td><strong>{customer.phone}</strong><span className="ml-2 text-xs text-slate-500">{customer.customerName ?? "未填姓名"}</span></td><td>{customer.stage}</td><td>{customer.currentOwner}</td><td>{customer.groupStatus === "JOINED" ? "在群" : customer.groupStatus === "LEFT" ? "已退群" : "未入群"}</td><td>{customer.nextPlan ?? "—"}</td></tr>)}
        {!detail.customers.length && <tr><td colSpan={5} className="empty-state">这个批次暂时没有可展示的手机号明细。</td></tr>}
      </tbody></table></div>
    </section>
    <section className="panel"><div className="panel-header"><div><h2 className="panel-title">阶段日期趋势</h2><p className="panel-subtitle">按实际发生日期排列</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>日期</th><th>添加数据</th><th>进群</th><th>注册</th><th>开单</th><th>入金</th></tr></thead><tbody>{detail.trend.map((point) => <tr key={point.occurredOn}><td>{point.occurredOn}</td><td>{point.totals.newFans}</td><td>{point.totals.groupJoin}</td><td>{point.totals.registration}</td><td>{point.totals.orders}</td><td>{money(point.totals.rechargeCents)}</td></tr>)}</tbody></table></div></section>
    <section className="panel"><div className="panel-header"><div><h2 className="panel-title">对应历史记录</h2><p className="panel-subtitle">只包含该批次、该录入人员的数据</p></div><Link className="text-sm font-semibold text-[#0b66ff]" href={historyHref}>在历史记录中查看</Link></div><div className="divide-y divide-slate-100">{detail.history.map((event) => <p className="flex justify-between px-5 py-3 text-sm" key={event.id}><span>{event.occurredOn} · {metricKindLabels[event.kind]}</span><strong>{formatMetricEventValue(event)}</strong></p>)}</div></section>
  </div>;
}
