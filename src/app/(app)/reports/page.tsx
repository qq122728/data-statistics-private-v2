import { redirect } from "next/navigation";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { getSystemSettings } from "../../../lib/settings";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { resolveDateRangeWithDefault } from "../../../lib/lead-date-range";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { formatUsd as money } from "../../../lib/money";
import { calculateFinancials } from "../../../lib/finance";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
type PerformanceLead = {
  isHistoricalRecord: boolean;
  invalid: boolean;
  receptionCategory: "PENDING" | "VALID" | "INVALID" | "LOW_AMOUNT" | "NO_WS";
  repliedOn: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  expertIntroducedOn: string | null;
  registeredOn: string | null;
  batch: {
    id: string;
    isHistoricalRecord: boolean;
    sourceDate: string;
    fanCostModeSnapshot: "FREE" | "PAID";
    effectiveFanPriceCentsSnapshot: number | null;
    channelTypeSnapshot: "SMS" | "ADS" | "REBATE";
    rebateRateBpsSnapshot: number | null;
    channel: { name: string };
  };
  customerOrder: null | { initialDepositCents: number; voidedAt: Date | null; events: Array<{ kind: string; amountCents: number | null; continuationNumber: number | null; voidedAt: Date | null }> };
};

function summarize(leads: PerformanceLead[]) {
  // 历史补录只贡献真实开单和资金；不应把它还原成一位新增有效粉，
  // 也不能抬高回复、入群、注册等漏斗数字。
  const workflowLeads = leads.filter((lead) => !lead.isHistoricalRecord && !lead.batch.isHistoricalRecord);
  const valid = workflowLeads.filter((lead) => !lead.invalid);
  const orders = leads.filter((lead) => lead.customerOrder && !lead.customerOrder.voidedAt);
  const initialCents = orders.reduce((sum, lead) => sum + (lead.customerOrder?.initialDepositCents ?? 0), 0);
  const rechargeCents = orders.reduce((sum, lead) => sum + (lead.customerOrder?.events ?? []).filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null && !event.voidedAt).reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
  const withdrawalCents = orders.reduce((sum, lead) => sum + (lead.customerOrder?.events ?? []).filter((event) => event.kind === "WITHDRAWAL" && !event.voidedAt).reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
  let costCents = 0;
  let rebateCents = 0;
  let creditedPerformanceCents = 0;
  let pendingPrice = false;
  const byBatch = new Map<string, PerformanceLead[]>();
  for (const lead of leads) byBatch.set(lead.batch.id, [...(byBatch.get(lead.batch.id) ?? []), lead]);
  for (const batchLeads of byBatch.values()) {
    const batch = batchLeads[0]!.batch;
    const batchOrders = batchLeads.filter((lead) => lead.customerOrder && !lead.customerOrder.voidedAt);
    const batchInitial = batchOrders.reduce((sum, lead) => sum + (lead.customerOrder?.initialDepositCents ?? 0), 0);
    const batchRecharge = batchOrders.reduce((sum, lead) => sum + (lead.customerOrder?.events ?? []).filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null && !event.voidedAt).reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
    const batchWithdrawal = batchOrders.reduce((sum, lead) => sum + (lead.customerOrder?.events ?? []).filter((event) => event.kind === "WITHDRAWAL" && !event.voidedAt).reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
    const financials = calculateFinancials({
      effectiveFans: batchLeads.filter((lead) => !lead.isHistoricalRecord && !lead.batch.isHistoricalRecord && !["INVALID", "LOW_AMOUNT", "NO_WS"].includes(lead.receptionCategory)).length,
      rechargeCents: batchInitial + batchRecharge,
      withdrawalCents: batchWithdrawal,
      channelPerformanceCents: 0,
      effectiveFanPriceCents: batch.fanCostModeSnapshot === "FREE" ? 0 : batch.effectiveFanPriceCentsSnapshot,
      channelType: batch.channelTypeSnapshot,
      rebateRateBps: batch.rebateRateBpsSnapshot,
    });
    rebateCents += financials.rebateCents ?? 0;
    if (financials.costCents === null || financials.profitCents === null) pendingPrice = true;
    else {
      costCents += financials.costCents;
      creditedPerformanceCents += financials.profitCents;
    }
  }
  return {
    valid: valid.length,
    replied: valid.filter((lead) => lead.repliedOn).length,
    inGroup: valid.filter((lead) => lead.groupStatus === "JOINED").length,
    introduced: valid.filter((lead) => lead.expertIntroducedOn).length,
    registered: valid.filter((lead) => lead.registeredOn).length,
    orders: orders.length,
    initialCents, rechargeCents, withdrawalCents,
    netCents: initialCents + rechargeCents - withdrawalCents,
    costCents: pendingPrice ? null : costCents,
    rebateCents,
    creditedPerformanceCents: pendingPrice ? null : creditedPerformanceCents,
  };
}

const rate = (numerator: number, denominator: number) => denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/reports");
    throw error;
  }
  if (user.role === "GROUP_OPERATOR") redirect("/group-customers");
  if (user.role === "EXPERT") redirect("/expert-customers");
  if (user.role !== "RECEPTION") redirect("/team-performance");

  const [params, settings] = await Promise.all([searchParams, getSystemSettings()]);
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
  const rawValues = Object.fromEntries(Object.entries(params).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const dateRange = resolveDateRangeWithDefault(rawValues, today, "month");
  const normalizedName = first(params.normalizedName) ?? "";
  const sourceDateFrom = dateRange.from;
  const sourceDateTo = dateRange.to;
  const sourceDate = sourceDateFrom || sourceDateTo ? { ...(sourceDateFrom ? { gte: sourceDateFrom } : {}), ...(sourceDateTo ? { lte: sourceDateTo } : {}) } : undefined;
  const [leads, channels] = await Promise.all([
    db.leadCustomer.findMany({
      where: { ownerId: user.id, batch: { ...(sourceDate ? { sourceDate } : {}), ...(normalizedName ? { channel: { normalizedName } } : {}) } },
      select: {
        isHistoricalRecord: true,
        invalid: true, receptionCategory: true, repliedOn: true, groupStatus: true, expertIntroducedOn: true, registeredOn: true,
        batch: { select: { id: true, isHistoricalRecord: true, sourceDate: true, fanCostModeSnapshot: true, effectiveFanPriceCentsSnapshot: true, channelTypeSnapshot: true, rebateRateBpsSnapshot: true, channel: { select: { name: true } } } },
        customerOrder: { select: { initialDepositCents: true, voidedAt: true, events: { where: { kind: { in: ["RECHARGE", "WITHDRAWAL"] } }, select: { kind: true, amountCents: true, continuationNumber: true, voidedAt: true } } } },
      },
      orderBy: [{ batch: { sourceDate: "desc" } }],
    }),
    db.channel.findMany({ where: { groupId: user.groupId ?? "__none__", active: true }, select: { normalizedName: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const totals = summarize(leads);
  const byChannel = [...new Set(leads.map((lead) => lead.batch.channel.name))].map((channel) => ({ channel, totals: summarize(leads.filter((lead) => lead.batch.channel.name === channel)) }));
  const byBatch = new Map<string, PerformanceLead[]>();
  leads.forEach((lead) => {
    const key = `${lead.batch.sourceDate} · ${lead.batch.channel.name}`;
    byBatch.set(key, [...(byBatch.get(key) ?? []), lead]);
  });

  return <main className="page-shell space-y-3"><div className="page-heading"><div><h1 className="page-title">我的业绩</h1><p className="page-description">所有数字都来自你的客户跟进记录；已作废的开单和资金不会计入。底料渠道按导入时冻结的返点比例结算。</p></div></div><LeadDateRangeFilter pathname="/reports" range={dateRange} today={today} preserve={{ normalizedName }} ariaLabel="我的业绩时间范围" /><form action="/reports" className="toolbar"><input type="hidden" name="range" value={dateRange.preset} /><input type="hidden" name="sourceDateFrom" value={dateRange.from} /><input type="hidden" name="sourceDateTo" value={dateRange.to} /><label className="field-label">渠道<select aria-label="渠道" name="normalizedName" defaultValue={normalizedName} className="control min-w-40"><option value="">全部渠道</option>{channels.map((channel) => <option key={channel.normalizedName} value={channel.normalizedName}>{channel.name}</option>)}</select></label><div className="ml-auto flex items-center gap-3"><a href="/reports" className="text-sm text-slate-500 hover:text-slate-800">重置</a><button className="inline-flex min-h-9 items-center rounded-lg bg-[#0b66ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0757dc]">查询</button></div></form><section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="grid divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-6">{[["有效粉", totals.valid], ["已回复", totals.replied], ["当前在群", totals.inGroup], ["已注册", totals.registered], ["已开单", totals.orders], ["计入业绩", totals.creditedPerformanceCents === null ? "待补单价" : money(totals.creditedPerformanceCents)]].map(([label, value]) => <div key={String(label)} className="px-4 py-3"><p className="m-0 text-xs text-slate-500">{label}</p><strong className="mt-1 block text-lg text-slate-900">{value}</strong></div>)}</div></section><section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.7fr)]"><div className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="m-0 text-base font-bold text-slate-900">转化进度</h2><p className="mt-1 text-xs text-slate-500">看客户现在走到哪一步</p></div><span className="text-sm text-slate-500">首充 {money(totals.initialCents)} · 续充 {money(totals.rechargeCents)}</span></div><div className="grid divide-y divide-slate-100 sm:grid-cols-5 sm:divide-x sm:divide-y-0">{[["有效粉", totals.valid, "—"], ["回复", totals.replied, rate(totals.replied, totals.valid)], ["入群", totals.inGroup, rate(totals.inGroup, totals.replied)], ["注册", totals.registered, rate(totals.registered, totals.inGroup)], ["开单", totals.orders, rate(totals.orders, totals.registered)]].map(([label, value, conversion]) => <div key={String(label)} className="px-4 py-3"><p className="m-0 text-xs text-slate-500">{label}</p><strong className="mt-1 block text-lg text-slate-900">{value}</strong><span className="mt-1 block text-xs text-blue-600">{conversion}</span></div>)}</div></div><div className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h2 className="m-0 text-base font-bold text-slate-900">资金汇总</h2><p className="mt-1 text-xs text-slate-500">计入业绩 = 入金－出金－资源成本－底料返点</p></div><dl className="m-0 divide-y divide-slate-100 px-4">{[["首充", money(totals.initialCents)], ["续充", money(totals.rechargeCents)], ["出金", money(totals.withdrawalCents)], ["原始净入金", money(totals.netCents)], ["资源成本", totals.costCents === null ? "待补单价" : money(totals.costCents)], ["渠道返点", money(totals.rebateCents)], ["计入业绩", totals.creditedPerformanceCents === null ? "待补单价" : money(totals.creditedPerformanceCents)]].map(([label, value]) => <div key={String(label)} className="flex justify-between py-2.5 text-sm"><dt className="text-slate-500">{label}</dt><dd className="m-0 font-semibold text-slate-900">{value}</dd></div>)}</dl></div></section><section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="m-0 text-base font-bold text-slate-900">渠道对比</h2><p className="mt-1 text-xs text-slate-500">方便判断哪一个来源质量更好</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>渠道</th><th>有效粉</th><th>回复</th><th>在群</th><th>注册</th><th>开单</th><th>有效粉开单率</th><th>计入业绩</th></tr></thead><tbody>{byChannel.map((row) => <tr key={row.channel}><td className="font-semibold">{row.channel}</td><td>{row.totals.valid}</td><td>{row.totals.replied}</td><td>{row.totals.inGroup}</td><td>{row.totals.registered}</td><td>{row.totals.orders}</td><td className="text-blue-600">{rate(row.totals.orders, row.totals.valid)}</td><td className="font-semibold">{row.totals.creditedPerformanceCents === null ? "待补单价" : money(row.totals.creditedPerformanceCents)}</td></tr>)}{!byChannel.length && <tr><td colSpan={8} className="empty-state">当前筛选没有客户数据</td></tr>}</tbody></table></div></section><section className="rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h2 className="m-0 text-base font-bold text-slate-900">来源批次</h2></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>来源日期 / 渠道</th><th>有效粉</th><th>回复</th><th>在群</th><th>注册</th><th>开单</th><th>计入业绩</th></tr></thead><tbody>{[...byBatch.entries()].map(([label, rows]) => { const item = summarize(rows); return <tr key={label}><td className="font-semibold">{label}</td><td>{item.valid}</td><td>{item.replied}</td><td>{item.inGroup}</td><td>{item.registered}</td><td>{item.orders}</td><td>{item.creditedPerformanceCents === null ? "待补单价" : money(item.creditedPerformanceCents)}</td></tr>; })}{!byBatch.size && <tr><td colSpan={7} className="empty-state">暂无来源批次</td></tr>}</tbody></table></div></section></main>;
}
