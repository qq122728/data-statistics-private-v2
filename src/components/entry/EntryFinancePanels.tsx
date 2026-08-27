import type { ReactNode } from "react";
import { formatUsd as money } from "../../lib/money";
import type { EntryFinanceEvent, EntryLead } from "./entry-types";

export function EntryFinanceSummary({ leads, today }: { leads: EntryLead[]; today: string }) {
  const initial = leads.filter((lead) => lead.customerOrder?.openedOn === today)
    .reduce((sum, lead) => sum + (lead.customerOrder?.initialDepositCents ?? 0), 0);
  const events = leads.flatMap((lead) => lead.customerOrder?.events ?? [])
    .filter((event) => event.occurredOn === today && !event.voidedAt);
  const recharge = events.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null)
    .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
  const withdrawal = events.filter((event) => event.kind === "WITHDRAWAL")
    .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
  return <div className="member-finance-summary">
    <span><small>今日首充</small><strong>{money(initial)}</strong></span>
    <span><small>今日续充</small><strong>{money(recharge)}</strong></span>
    <span><small>今日总入金</small><strong>{money(initial + recharge)}</strong></span>
    <span><small>今日出金</small><strong>{money(withdrawal)}</strong></span>
    <span><small>当日净业绩</small><strong>{money(initial + recharge - withdrawal)}</strong></span>
  </div>;
}

export function buildEntryFinanceHistory(leads: EntryLead[]) {
  return leads.flatMap((lead) => {
    if (!lead.customerOrder) return [];
    const initialEvent = lead.customerOrder.events.find((event) => event.kind === "RECHARGE" && event.continuationNumber === null);
    return [{
      lead,
      event: initialEvent,
      occurredOn: lead.customerOrder.openedOn,
      kind: "首充",
      amountCents: lead.customerOrder.initialDepositCents,
      continuationNumber: null,
      voidedAt: lead.customerOrder.voidedAt ?? initialEvent?.voidedAt ?? null,
      voidReason: lead.customerOrder.voidReason ?? initialEvent?.voidReason ?? null,
    }, ...lead.customerOrder.events
      .filter((event) => !(event.kind === "RECHARGE" && event.continuationNumber === null))
      .map((event) => ({
        lead,
        event,
        occurredOn: event.occurredOn,
        kind: event.kind === "RECHARGE" ? "续充入金" : "出金",
        amountCents: event.amountCents ?? 0,
        continuationNumber: event.continuationNumber,
        voidedAt: event.voidedAt,
        voidReason: event.voidReason,
      }))];
  }).sort((left, right) => right.occurredOn.localeCompare(left.occurredOn));
}

export function EntryFinanceHistory({
  leads,
  empty,
  context,
  onVoid,
}: {
  leads: EntryLead[];
  empty: (text: string) => ReactNode;
  context: (lead: EntryLead) => ReactNode;
  onVoid: (lead: EntryLead, event: EntryFinanceEvent, label: string) => void;
}) {
  const records = buildEntryFinanceHistory(leads);
  return <div className="member-table-wrap"><table className="member-table">
    <thead><tr><th>发生日期</th><th>手机号</th><th>客户姓名</th><th>类型</th><th>金额</th><th>续充次数</th><th>来源 / 设备</th><th>记录状态</th><th>纠错原因</th><th>操作</th></tr></thead>
    <tbody>
      {records.map((record, index) => <tr key={`${record.lead.id}-${record.kind}-${record.occurredOn}-${index}`} data-invalid={Boolean(record.voidedAt) || undefined}>
        <td>{record.occurredOn}</td><td className="member-phone">{record.lead.phone}</td><td>{record.lead.customerName ?? "—"}</td><td>{record.kind}</td><td>{money(record.amountCents)}</td>
        <td>{record.continuationNumber ? `第 ${record.continuationNumber} 次` : "—"}</td><td>{context(record.lead)}</td>
        <td>{record.voidedAt ? <span className="member-stage" data-tone="muted">已作废</span> : <span className="member-stage" data-tone="success">有效</span>}</td>
        <td>{record.voidReason ?? "—"}</td>
        <td>{record.voidedAt ? "—" : record.event && record.kind !== "首充" ? <button type="button" className="member-text-action danger" onClick={() => onVoid(record.lead, record.event!, record.kind)}>作废</button> : "请作废开单"}</td>
      </tr>)}
      {!records.length && <tr><td colSpan={10}>{empty("暂无财务流水记录")}</td></tr>}
    </tbody>
  </table></div>;
}
