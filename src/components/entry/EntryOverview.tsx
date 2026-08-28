import { formatUsd as money } from "../../lib/money";
import type { EntryLead, EntrySummary } from "./entry-types";

export type EntryOverviewData = {
  mine: EntrySummary;
  group: EntrySummary;
  channels: Array<{ channel: string; mine: EntrySummary; group: EntrySummary }>;
};

type DailyMetrics = {
  date: string; added: number; lowAmount: number; noWs: number; collision: number; valid: number;
  joined: number; left: number; introduced: number; registered: number; opened: number;
  incomeCents: number; withdrawalCents: number; netCents: number;
};

type InvalidReport = { sourceDate: string; noWsCount: number; lowAmountCount: number; collisionCount: number; total: number };

function metricsForDate(leads: EntryLead[], reports: InvalidReport[], date: string): DailyMetrics {
  const sourced = leads.filter((lead) => lead.batch.sourceDate === date);
  const activeOrders = leads.filter((lead) => lead.customerOrder && !lead.customerOrder.voidedAt);
  const initialCents = activeOrders.filter((lead) => lead.customerOrder?.openedOn === date)
    .reduce((sum, lead) => sum + (lead.customerOrder?.initialDepositCents ?? 0), 0);
  // 登记开单时会额外写一条 continuationNumber 为空的 RECHARGE 镜像行（金额=首充），
  // 只有带序号的才是真实续充；不过滤会把首充再算一遍（下方 incomeCents 已单独加过首充）。
  const rechargeCents = activeOrders.reduce((sum, lead) => sum + (lead.customerOrder?.events ?? [])
    .filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null && event.occurredOn === date && !event.voidedAt)
    .reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
  const withdrawalCents = activeOrders.reduce((sum, lead) => sum + (lead.customerOrder?.events ?? [])
    .filter((event) => event.kind === "WITHDRAWAL" && event.occurredOn === date && !event.voidedAt)
    .reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
  const incomeCents = initialCents + rechargeCents;
  const lowAmount = sourced.filter((lead) => lead.receptionCategory === "LOW_AMOUNT").length;
  const noWs = sourced.filter((lead) => lead.receptionCategory === "NO_WS").length;
  const reported = reports.filter((report) => report.sourceDate === date).reduce((sum, report) => ({ total: sum.total + report.total, lowAmount: sum.lowAmount + report.lowAmountCount, noWs: sum.noWs + report.noWsCount, collision: sum.collision + report.collisionCount }), { total: 0, lowAmount: 0, noWs: 0, collision: 0 });
  return {
    date,
    added: sourced.length + reported.total,
    lowAmount: lowAmount + reported.lowAmount,
    noWs: noWs + reported.noWs,
    collision: reported.collision,
    valid: sourced.length - lowAmount - noWs,
    joined: leads.filter((lead) => lead.joinedOn === date).length,
    left: leads.filter((lead) => lead.leftOn === date).length,
    introduced: leads.filter((lead) => lead.expertIntroducedOn === date).length,
    registered: leads.filter((lead) => lead.registeredOn === date).length,
    opened: activeOrders.filter((lead) => lead.customerOrder?.openedOn === date).length,
    incomeCents, withdrawalCents, netCents: incomeCents - withdrawalCents,
  };
}

export function EntryOverview({ leads, invalidReports = [], today }: { overview?: EntryOverviewData; leads: EntryLead[]; invalidReports?: InvalidReport[]; today: string }) {
  const month = today.slice(0, 7);
  const dates = new Set<string>([today]);
  for (const lead of leads) {
    for (const date of [lead.batch.sourceDate, lead.joinedOn, lead.leftOn, lead.expertIntroducedOn, lead.registeredOn, lead.customerOrder?.openedOn])
      if (date?.startsWith(month)) dates.add(date);
    for (const event of lead.customerOrder?.events ?? []) if (event.occurredOn.startsWith(month)) dates.add(event.occurredOn);
  }
  for (const report of invalidReports) if (report.sourceDate.startsWith(month)) dates.add(report.sourceDate);
  const dailyRows = [...dates].sort((left, right) => right.localeCompare(left)).map((date) => metricsForDate(leads, invalidReports, date));
  const current = metricsForDate(leads, invalidReports, today);
  const monthly = dailyRows.reduce((sum, row) => ({
    added: sum.added + row.added, lowAmount: sum.lowAmount + row.lowAmount, noWs: sum.noWs + row.noWs, collision: sum.collision + row.collision,
    valid: sum.valid + row.valid, joined: sum.joined + row.joined, left: sum.left + row.left,
    introduced: sum.introduced + row.introduced, registered: sum.registered + row.registered, opened: sum.opened + row.opened,
    incomeCents: sum.incomeCents + row.incomeCents, withdrawalCents: sum.withdrawalCents + row.withdrawalCents, netCents: sum.netCents + row.netCents,
  }), { added: 0, lowAmount: 0, noWs: 0, collision: 0, valid: 0, joined: 0, left: 0, introduced: 0, registered: 0, opened: 0, incomeCents: 0, withdrawalCents: 0, netCents: 0 });
  const currentInGroup = leads.filter((lead) => lead.groupStatus === "JOINED").length;
  const todayItems: Array<[string, string | number]> = [
    ["当日添加数据", current.added], ["当日撞粉", current.collision], ["当日低金额", current.lowAmount], ["当日无 WS 号码", current.noWs],
    ["当日有效数据", current.valid], ["当日进群", current.joined], ["当日退群", current.left],
    ["当日介绍专家", current.introduced], ["当日注册", current.registered], ["当日开单", current.opened],
    ["当日入金", money(current.incomeCents)], ["当日出金", money(current.withdrawalCents)], ["当日净业绩", money(current.netCents)],
  ];
  return <section className="member-panel reception-performance">
    <div className="member-panel-title"><div><p>第 5 步</p><h3>个人数据</h3></div><span>指标名称和计算严格按照接粉岗位口径</span></div>
    <div className="reception-metric-strip">{todayItems.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="reception-month-summary"><strong>当月汇总</strong><span>当月添加 {monthly.added}</span><span>当月有效 {monthly.valid}</span><span>当月进群 {monthly.joined}</span><span>当月退群 {monthly.left}</span><span>当月在群数据 {monthly.joined - monthly.left}</span><span>当前在群 {currentInGroup}</span><span>当月净业绩 {money(monthly.netCents)}</span></div>
    <div className="member-table-wrap"><table className="member-table reception-daily-table">
      <thead><tr><th>日期</th><th>添加</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>有效</th><th>进群</th><th>退群</th><th>介绍专家</th><th>注册</th><th>开单</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead>
      <tbody>{dailyRows.map((row) => <tr key={row.date}><td><strong>{row.date}</strong></td><td>{row.added}</td><td>{row.collision}</td><td>{row.lowAmount}</td><td>{row.noWs}</td><td>{row.valid}</td><td>{row.joined}</td><td>{row.left}</td><td>{row.introduced}</td><td>{row.registered}</td><td>{row.opened}</td><td>{money(row.incomeCents)}</td><td>{money(row.withdrawalCents)}</td><td><strong>{money(row.netCents)}</strong></td></tr>)}</tbody>
    </table></div>
    <p className="reception-metric-note">口径：当日添加数据包含组长已确认的扣粉数字；有效数据 = 添加数据 − 撞粉 − 低金额 − 无 WS 号码；当月在群数据 = 当月进群 − 当月退群；当日净业绩 = 当日入金 − 当日出金。</p>
  </section>;
}
