import { formatUsd as money } from "../../lib/money";

type CustomerOrderHistoryItem = {
  id: string;
  phone: string;
  openedOn: string;
  initialDepositCents: number;
  voidedAt?: Date | string | null;
  enteredBy: { name: string };
  batch: { sourceDate: string; channel: { name: string }; group: { name: string } };
  events: Array<{ kind: string; amountCents: number | null; occurredOn: string; continuationNumber: number | null; voidedAt?: Date | string | null }>;
};

export function CustomerOrderHistory({ orders }: { orders: CustomerOrderHistoryItem[] }) {
  const activeOrders = orders.filter((order) => !order.voidedAt);
  return <section className="panel overflow-hidden" aria-labelledby="customer-ledger-title">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 id="customer-ledger-title" className="m-0 text-base font-semibold text-slate-950">开单号码与财务流水</h2><p className="mb-0 mt-1 text-sm text-slate-500">首充、每次续充和出金都跟随手机号追溯到原始粉来源。</p></div><span className="text-sm text-slate-400">共 {activeOrders.length} 个开单号码</span></div>
    {activeOrders.length ? <div className="overflow-x-auto"><table className="data-table min-w-[1050px]"><thead><tr><th>开单日期 / 号码</th><th>来源批次</th><th>录入人</th><th className="text-right">首充</th><th>续充明细</th><th className="text-right">出金</th><th className="text-right">累计净业绩</th></tr></thead><tbody>{activeOrders.map((order) => {
      const activeEvents = order.events.filter((event) => !event.voidedAt);
      const continuations = activeEvents.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null);
      const withdrawals = activeEvents.filter((event) => event.kind === "WITHDRAWAL");
      const continuationCents = continuations.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
      const withdrawalCents = withdrawals.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
      const net = order.initialDepositCents + continuationCents - withdrawalCents;
      return <tr key={order.id}><td><strong className="block text-slate-900">{order.phone}</strong><span className="text-xs text-slate-500">{order.openedOn}</span></td><td>{order.batch.sourceDate} · {order.batch.channel.name}<span className="block text-xs text-slate-500">{order.batch.group.name}</span></td><td>{order.enteredBy.name}</td><td className="text-right font-semibold">{money(order.initialDepositCents)}</td><td>{continuations.length ? continuations.map((event) => <span key={`${event.continuationNumber}-${event.occurredOn}`} className="mr-2 inline-block whitespace-nowrap text-sm">第 {event.continuationNumber} 次 {money(event.amountCents ?? 0)} <small className="text-slate-400">{event.occurredOn}</small></span>) : <span className="text-slate-400">暂无续充</span>}</td><td className="text-right">{money(withdrawalCents)}</td><td className={`text-right font-semibold ${net < 0 ? "text-red-600" : "text-emerald-700"}`}>{money(net)}</td></tr>;
    })}</tbody></table></div> : <div className="empty-state">没有符合条件的开单号码</div>}
  </section>;
}
