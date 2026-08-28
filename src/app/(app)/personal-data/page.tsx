import { redirect } from "next/navigation";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { db } from "../../../lib/db";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { getSystemSettings } from "../../../lib/settings";
import { LeadDateRangeFilter } from "../../../components/lead/LeadDateRangeFilter";
import { resolveDateRangeWithDefault, type LeadDateRange } from "../../../lib/lead-date-range";
import { formatUsd } from "../../../lib/money";
import { assessGroupLeave } from "../../../lib/group-leave";

type SearchParams = Record<string, string | string[] | undefined>;
type ReceptionCategory = "PENDING" | "VALID" | "INVALID" | "LOW_AMOUNT" | "NO_WS";
type FrontlineRole = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";

type PersonalLead = {
  isHistoricalRecord: boolean;
  invalid: boolean;
  receptionCategory: ReceptionCategory;
  repliedOn: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  registeredOn: string | null;
  expertStalledOn: string | null;
  noInitialDepositOn: string | null;
  batch: { sourceDate: string; isHistoricalRecord: boolean };
  customerOrder: null | {
    openedOn: string;
    initialDepositCents: number;
    voidedAt: Date | null;
    events: Array<{ kind: string; occurredOn: string; amountCents: number | null; continuationNumber: number | null; voidedAt: Date | null }>;
  };
};

type Totals = {
  added: number; lowAmount: number; noWs: number; effective: number; replied: number;
  joined: number; left: number; earlyLeft: number; introduced: number; contacted: number;
  registered: number; orders: number; noInitialDeposit: number; stalled: number;
  initialDepositCents: number; rechargeCents: number; withdrawalCents: number; netCents: number;
};

const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
const isInRange = (value: string | null | undefined, range: LeadDateRange) => Boolean(value && value >= range.from && value <= range.to);
const resourceExcluded = (lead: Pick<PersonalLead, "invalid" | "receptionCategory">) => lead.invalid || ["INVALID", "LOW_AMOUNT", "NO_WS"].includes(lead.receptionCategory);
const isHistorical = (lead: PersonalLead) => lead.isHistoricalRecord || lead.batch.isHistoricalRecord;
const emptyTotals = (): Totals => ({ added: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0, left: 0, earlyLeft: 0, introduced: 0, contacted: 0, registered: 0, orders: 0, noInitialDeposit: 0, stalled: 0, initialDepositCents: 0, rechargeCents: 0, withdrawalCents: 0, netCents: 0 });
const rate = (numerator: number, denominator: number) => denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";

function summarize(leads: PersonalLead[], range: LeadDateRange) {
  const totals = emptyTotals();
  for (const lead of leads) {
    if (!isHistorical(lead) && isInRange(lead.batch.sourceDate, range)) {
      totals.added += 1;
      if (lead.receptionCategory === "LOW_AMOUNT") totals.lowAmount += 1;
      if (lead.receptionCategory === "NO_WS") totals.noWs += 1;
      if (!resourceExcluded(lead)) totals.effective += 1;
    }
    if (!isHistorical(lead)) {
      if (isInRange(lead.repliedOn, range)) totals.replied += 1;
      if (isInRange(lead.joinedOn, range)) totals.joined += 1;
      if (isInRange(lead.leftOn, range)) {
        totals.left += 1;
        if (assessGroupLeave(lead.joinedOn, lead.leftOn).level === "EARLY") totals.earlyLeft += 1;
      }
      if (isInRange(lead.expertIntroducedOn, range)) totals.introduced += 1;
      if (isInRange(lead.expertContactedOn, range)) totals.contacted += 1;
      if (isInRange(lead.registeredOn, range)) totals.registered += 1;
      if (isInRange(lead.noInitialDepositOn, range)) totals.noInitialDeposit += 1;
      if (isInRange(lead.expertStalledOn, range)) totals.stalled += 1;
    }
    const order = lead.customerOrder;
    if (!order || order.voidedAt) continue;
    if (isInRange(order.openedOn, range)) {
      totals.orders += 1;
      totals.initialDepositCents += order.initialDepositCents;
    }
    for (const event of order.events) {
      if (event.voidedAt || !isInRange(event.occurredOn, range)) continue;
      // 登记开单时会额外写一条 continuationNumber 为空的 RECHARGE 镜像行（金额=首充），
      // 只有带序号的才是真实续充；不过滤会把首充再算一遍。
      if (event.kind === "RECHARGE" && event.continuationNumber !== null) totals.rechargeCents += event.amountCents ?? 0;
      if (event.kind === "WITHDRAWAL") totals.withdrawalCents += event.amountCents ?? 0;
    }
  }
  totals.netCents = totals.initialDepositCents + totals.rechargeCents - totals.withdrawalCents;
  return totals;
}

function dailyRows(leads: PersonalLead[], range: LeadDateRange) {
  const dates = new Set<string>();
  for (const lead of leads) {
    [lead.batch.sourceDate, lead.repliedOn, lead.joinedOn, lead.leftOn, lead.expertIntroducedOn, lead.expertContactedOn, lead.registeredOn, lead.noInitialDepositOn, lead.expertStalledOn, lead.customerOrder?.openedOn]
      .filter((value): value is string => isInRange(value, range)).forEach((value) => dates.add(value));
    for (const event of lead.customerOrder?.events ?? []) if (!event.voidedAt && isInRange(event.occurredOn, range)) dates.add(event.occurredOn);
  }
  return [...dates].sort((a, b) => b.localeCompare(a)).map((date) => ({ date, totals: summarize(leads, { preset: "custom", from: date, to: date, label: date }) }));
}

function currentInGroup(leads: PersonalLead[]) {
  return leads.filter((lead) => !isHistorical(lead) && lead.groupStatus === "JOINED").length;
}

function CoreData({ title, description, items }: { title: string; description: string; items: Array<[string, string | number]> }) {
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h2 className="m-0 text-base font-bold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div><div className="data-table-wrap"><table className="data-table whitespace-nowrap"><thead><tr>{items.map(([label]) => <th key={label}>{label}</th>)}</tr></thead><tbody><tr>{items.map(([label, value]) => <td key={label} className={label === "净业绩" ? "font-semibold text-slate-900" : undefined}>{value}</td>)}</tr></tbody></table></div></section>;
}

function ReceptionTables({ leads, range }: { leads: PersonalLead[]; range: LeadDateRange }) {
  const totals = summarize(leads, range);
  const rows = dailyRows(leads, range);
  return <>
    <CoreData title="我的核心数据" description="撞粉、低金额和无 WS 号码不计入有效数据；后续流程和资金仍按所有本人客户统计。" items={[["添加", totals.added], ["低金额", totals.lowAmount], ["无 WS 号码", totals.noWs], ["有效数据", totals.effective], ["回复", totals.replied], ["进群", totals.joined], ["推专家", totals.introduced], ["注册", totals.registered], ["开单", totals.orders], ["入金", formatUsd(totals.initialDepositCents + totals.rechargeCents)], ["出金", formatUsd(totals.withdrawalCents)], ["净业绩", formatUsd(totals.netCents)]]} />
    <section className="personal-data-table"><h2>每日明细</h2><p>回复率 = 回复 ÷ 有效数据；进群率 = 进群 ÷ 回复；开单率 = 开单 ÷ 注册。</p><div className="data-table-wrap"><table className="data-table whitespace-nowrap"><thead><tr><th>日期</th><th>添加</th><th>低金额</th><th>无 WS 号码</th><th>有效</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>推专家</th><th>注册</th><th>开单</th><th>开单率</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{rows.map(({ date, totals: row }) => <tr key={date}><td className="font-semibold">{date}</td><td>{row.added}</td><td>{row.lowAmount}</td><td>{row.noWs}</td><td>{row.effective}</td><td>{row.replied}</td><td>{rate(row.replied, row.effective)}</td><td>{row.joined}</td><td>{rate(row.joined, row.replied)}</td><td>{row.introduced}</td><td>{row.registered}</td><td>{row.orders}</td><td>{rate(row.orders, row.registered)}</td><td>{formatUsd(row.initialDepositCents + row.rechargeCents)}</td><td>{formatUsd(row.withdrawalCents)}</td><td className="font-semibold">{formatUsd(row.netCents)}</td></tr>)}{!rows.length && <EmptyRow columns={16} />}</tbody></table></div></section>
  </>;
}

function GroupOperatorTables({ leads, range }: { leads: PersonalLead[]; range: LeadDateRange }) {
  const totals = summarize(leads, range);
  const rows = dailyRows(leads, range);
  const workflowLeads = leads.filter((lead) => !isHistorical(lead));
  return <>
    <CoreData title="我的核心数据" description="只统计你接手的常规客户。历史补录不进入群数量和流程转化，但其开单与资金仍计入财务。" items={[["接手客户", workflowLeads.length], ["进群", totals.joined], ["当前在群", currentInGroup(leads)], ["退群", totals.left], ["提前退群", totals.earlyLeft], ["推专家", totals.introduced], ["推专家率", rate(totals.introduced, totals.joined)], ["专家已联系", totals.contacted], ["已注册", totals.registered], ["已开单", totals.orders]]} />
    <section className="personal-data-table"><h2>每日明细</h2><p>在群存量按当天结束时仍在群的常规客户计算，方便看群内客户是否在流失。</p><div className="data-table-wrap"><table className="data-table whitespace-nowrap"><thead><tr><th>日期</th><th>进群</th><th>退群</th><th>提前退群</th><th>在群存量</th><th>推专家</th><th>推专家率</th><th>专家已联系</th><th>已注册</th><th>已开单</th></tr></thead><tbody>{rows.map(({ date, totals: row }) => <tr key={date}><td className="font-semibold">{date}</td><td>{row.joined}</td><td>{row.left}</td><td>{row.earlyLeft}</td><td>{workflowLeads.filter((lead) => Boolean(lead.joinedOn && lead.joinedOn <= date && (!lead.leftOn || lead.leftOn > date))).length}</td><td>{row.introduced}</td><td>{rate(row.introduced, row.joined)}</td><td>{row.contacted}</td><td>{row.registered}</td><td>{row.orders}</td></tr>)}{!rows.length && <EmptyRow columns={10} />}</tbody></table></div></section>
  </>;
}

function ExpertTables({ leads, range }: { leads: PersonalLead[]; range: LeadDateRange }) {
  const totals = summarize(leads, range);
  const rows = dailyRows(leads, range);
  const workflowLeads = leads.filter((lead) => !isHistorical(lead));
  return <>
    <CoreData title="我的核心数据" description="只统计分配给你的常规客户。历史补录只贡献开单和资金；金额 = 首充 + 续充 − 出金。" items={[["跟进客户", workflowLeads.length], ["已联系", totals.contacted], ["联系率", rate(totals.contacted, workflowLeads.length)], ["已注册", totals.registered], ["注册率", rate(totals.registered, totals.contacted)], ["已开单", totals.orders], ["开单率", rate(totals.orders, totals.registered)], ["首充", formatUsd(totals.initialDepositCents)], ["续充", formatUsd(totals.rechargeCents)], ["出金", formatUsd(totals.withdrawalCents)], ["净业绩", formatUsd(totals.netCents)], ["不首充", totals.noInitialDeposit], ["杀不动", totals.stalled]]} />
    <section className="personal-data-table"><h2>每日明细</h2><p>注册率 = 注册 ÷ 已联系；开单率 = 开单 ÷ 已注册。金额按当天实际发生日期计算。</p><div className="data-table-wrap"><table className="data-table whitespace-nowrap"><thead><tr><th>日期</th><th>已联系</th><th>已注册</th><th>注册率</th><th>已开单</th><th>开单率</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th><th>不首充</th><th>杀不动</th></tr></thead><tbody>{rows.map(({ date, totals: row }) => <tr key={date}><td className="font-semibold">{date}</td><td>{row.contacted}</td><td>{row.registered}</td><td>{rate(row.registered, row.contacted)}</td><td>{row.orders}</td><td>{rate(row.orders, row.registered)}</td><td>{formatUsd(row.initialDepositCents)}</td><td>{formatUsd(row.rechargeCents)}</td><td>{formatUsd(row.withdrawalCents)}</td><td className="font-semibold">{formatUsd(row.netCents)}</td><td>{row.noInitialDeposit}</td><td>{row.stalled}</td></tr>)}{!rows.length && <EmptyRow columns={12} />}</tbody></table></div></section>
  </>;
}

function EmptyRow({ columns }: { columns: number }) { return <tr><td colSpan={columns} className="empty-state">当前时间范围暂无你的客户数据</td></tr>; }

export default async function PersonalDataPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); } catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/personal-data"); throw error; }
  if (!(["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const).includes(user.role as FrontlineRole)) redirect("/dashboard");
  const role = user.role as FrontlineRole;
  const [params, settings] = await Promise.all([searchParams, getSystemSettings()]);
  const timezone = await resolveUserBusinessTimezone(user, settings.timezone);
  const today = localDateYYYYMMDD(new Date(), timezone);
  const raw = Object.fromEntries(Object.entries(params).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const dateRange = resolveDateRangeWithDefault(raw, today, "month");
  const leads = await db.leadCustomer.findMany({
    where: role === "RECEPTION" ? { ownerId: user.id } : role === "GROUP_OPERATOR" ? { groupOperatorOwnerId: user.id } : { expertOwnerId: user.id },
    select: {
      isHistoricalRecord: true, invalid: true, receptionCategory: true, repliedOn: true, joinedOn: true, leftOn: true, groupStatus: true, expertIntroducedOn: true, expertContactedOn: true, registeredOn: true, expertStalledOn: true, noInitialDepositOn: true,
      batch: { select: { sourceDate: true, isHistoricalRecord: true } },
      customerOrder: { select: { openedOn: true, initialDepositCents: true, voidedAt: true, events: { where: { kind: { in: ["RECHARGE", "WITHDRAWAL"] } }, select: { kind: true, occurredOn: true, amountCents: true, continuationNumber: true, voidedAt: true } } } },
    },
  }) as PersonalLead[];
  const heading = role === "RECEPTION" ? ["个人数据", "查看本人接粉数据、转化和后续业绩。"] : role === "GROUP_OPERATOR" ? ["个人数据", "查看本人接手、在群、推专家和退群情况。"] : ["个人数据", "查看本人客户的联系、注册、开单和资金结果。"];
  return <main className="page-shell space-y-3"><div className="page-heading"><div><h1 className="page-title">{heading[0]}</h1><p className="page-description">{heading[1]}</p></div></div><LeadDateRangeFilter pathname="/personal-data" range={dateRange} today={today} ariaLabel="个人数据时间范围" />{role === "RECEPTION" ? <ReceptionTables leads={leads} range={dateRange} /> : role === "GROUP_OPERATOR" ? <GroupOperatorTables leads={leads} range={dateRange} /> : <ExpertTables leads={leads} range={dateRange} />}</main>;
}
