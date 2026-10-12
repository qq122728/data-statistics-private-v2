import { investmentSummary } from "../../../packages/customer-sheet/investment";
import type { SheetData } from "../../../packages/customer-sheet/schema";

export type AnalysisRow = {
  id: string; phone: string; group: string; channel: string; channelId: string;
  type: string; buyer: string; country: string; material: string;
  attributed: boolean; data: SheetData;
};
export type Cash = { firstCents: number; rechargeCents: number; withdrawalCents: number; netCents: number; customers: number; newOrders: number };
export type Warning = { key: string; level: "核对" | "观察"; title: string; evidence: string; action: string };
const dayMs = 86400000;
export const analysisDay = (value: unknown) => {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s ? s : "";
};
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / dayMs;
const shift = (d: string, n: number) => new Date(Date.parse(d) + n * dayMs).toISOString().slice(0, 10);
const cash = (): Cash => ({ firstCents: 0, rechargeCents: 0, withdrawalCents: 0, netCents: 0, customers: 0, newOrders: 0 });
const money = (n: number) => (n / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number, d: number) => d ? (100 * n / d).toFixed(1) + "%" : "—";

export function analyzeResources(rows: AnalysisRow[], range: { from: string; to: string }, extras: { pending: number; ambiguous: number; spendRecords: number; importCount: number }, completedThrough = range.to) {
  if (range.from.slice(0, 7) !== range.to.slice(0, 7)) throw Error("资源分析一次请选择一个自然月内的日期，跨月请分别查询后对比");
  const month = range.to.slice(0, 7);
  const lastMonthEnd = shift(month + "-01", -1);
  const previousMonth = lastMonthEnd.slice(0, 7);
  // Match day-of-month and trim BOTH ranges when the previous month is shorter.
  const previousEndDay = Math.min(Number(range.to.slice(-2)), Number(lastMonthEnd.slice(-2)));
  const comparisonFrom = range.from;
  const comparisonTo = month + "-" + String(previousEndDay).padStart(2, "0");
  const comparable = comparisonFrom <= comparisonTo;
  const previousFrom = previousMonth + range.from.slice(7);
  const previousTo = previousMonth + "-" + String(previousEndDay).padStart(2, "0");
  const totals = cash(), daily = cash(), previous = cash(), comparison = cash();
  const buckets: Record<string, Cash> = { "本月开单": cash(), "上月开单": cash(), "更早开单": cash(), "开单日期缺失或矛盾": cash() };
  const types: Record<string, Cash> = { ADS: cash(), SMS: cash() };
  const attribution: Record<string, Cash> = { "已归属": cash(), "未归属或归属冲突": cash() };
  const rowDetails: Array<{ phone: string; group: string; channel: string; buyer: string; country: string; intakeOn: string; openedOn: string; bucket: string } & Cash> = [];
  const cohortMatrix = new Map<string, { month: string; customerCount: number; current: Cash; previous: Cash }>();
  const matured = new Map<string, { month: string; windowDays: number; eligible: number; immature: number; renewed: number; firstCents: number; rechargeCents: number; withdrawalCents: number }>();
  let missingFirstDateCents = 0, undatedRechargeCents = 0, futureEvents = 0, inconsistentEvents = 0, legacyCents = 0, missingFirstAmount = 0;
  const prepared = rows.map(row => {
    const amounts = investmentSummary(row.data);
    const opened = analysisDay(row.data.firstDepositOn || row.data.orderedOn);
    const intake = analysisDay(row.data.intakeOn);
    const events = [
      ...(amounts.firstCents > 0 ? [{ date: opened, kind: "first", amountCents: amounts.firstCents }] : []),
      ...amounts.entries.map(e => ({ date: analysisDay(e.date), kind: e.kind === "withdrawal" ? "withdrawal" : "recharge", amountCents: e.amountCents })),
    ];
    const ambiguousOpening = !opened || (!!intake && opened < intake);
    if (!amounts.firstCents && events.some(e => e.kind === "recharge" && e.date >= range.from && e.date <= range.to)) missingFirstAmount++;
    if (amounts.firstCents > 0 && !opened) missingFirstDateCents += amounts.firstCents;
    legacyCents += amounts.baseCents;
    for (const e of events) {
      if (!e.date && e.kind !== "first") undatedRechargeCents += Math.abs(e.amountCents);
      if (e.date > range.to) futureEvents++;
      if (e.date && ((intake && e.date < intake) || (opened && e.kind !== "first" && e.date < opened))) inconsistentEvents++;
    }
    const add = (s: Cash, from: string, to: string) => {
      const selected = events.filter(e => e.date && e.date >= from && e.date <= to);
      if (!selected.length) return;
      s.customers++;
      for (const e of selected) {
        if (e.kind === "first") { s.firstCents += e.amountCents; s.newOrders++; }
        else if (e.kind === "withdrawal") s.withdrawalCents += e.amountCents;
        else s.rechargeCents += e.amountCents;
      }
      s.netCents = s.firstCents + s.rechargeCents - s.withdrawalCents;
    };
    const bucket = ambiguousOpening || opened > range.to || events.some(e => e.date >= range.from && e.date <= range.to && e.date < opened)
      ? "开单日期缺失或矛盾" : opened.slice(0, 7) === month ? "本月开单" : opened.slice(0, 7) === previousMonth ? "上月开单" : "更早开单";
    add(totals, range.from, range.to); add(daily, range.to, range.to);
    add(buckets[bucket], range.from, range.to); add(types[row.type] ??= cash(), range.from, range.to);
    add(attribution[row.attributed ? "已归属" : "未归属或归属冲突"], range.from, range.to);
    if (comparable) { add(previous, previousFrom, previousTo); add(comparison, comparisonFrom, comparisonTo); }
    const detail = cash(); add(detail, range.from, range.to);
    if (detail.customers) rowDetails.push({ phone: row.phone, group: row.group, channel: row.channel, buyer: row.buyer || "未归属", country: row.country || "未知", intakeOn: intake, openedOn: opened, bucket, ...detail });
    const cohort = ambiguousOpening ? "日期缺失或矛盾" : opened.slice(0, 7);
    if (cohort <= month || ambiguousOpening) {
      const c = cohortMatrix.get(cohort) ?? { month: cohort, customerCount: 0, current: cash(), previous: cash() };
      if (amounts.firstCents > 0 && opened && opened <= range.to) c.customerCount++;
      add(c.current, range.from, range.to); if (comparable) add(c.previous, previousFrom, previousTo);
      cohortMatrix.set(cohort, c);
    }
    if (opened && !ambiguousOpening && amounts.firstCents > 0 && opened <= range.to) {
      for (const windowDays of [7, 30, 60]) {
        const key = cohort + "|" + windowDays;
        const m = matured.get(key) ?? { month: cohort, windowDays, eligible: 0, immature: 0, renewed: 0, firstCents: 0, rechargeCents: 0, withdrawalCents: 0 };
        // Opening day is day 1. Only completed calendar windows enter the denominator.
        if (days(opened, completedThrough) < windowDays - 1) m.immature++;
        else {
          m.eligible++; m.firstCents += amounts.firstCents;
          const selected = events.filter(e => e.kind !== "first" && e.date >= opened && days(opened, e.date) < windowDays);
          if (selected.some(e => e.kind === "recharge" && e.amountCents > 0)) m.renewed++;
          for (const e of selected) m[e.kind === "withdrawal" ? "withdrawalCents" : "rechargeCents"] += e.amountCents;
        }
        matured.set(key, m);
      }
    }
    return { ...row, opened, intake, amounts, events, ambiguousOpening };
  });
  const warnings: Warning[] = [];
  const warn = (key: string, level: Warning["level"], title: string, evidence: string, action: string) => warnings.push({ key, level, title, evidence, action });
  if (buckets["开单日期缺失或矛盾"].customers || missingFirstDateCents || undatedRechargeCents || legacyCents || inconsistentEvents || missingFirstAmount)
    warn("opening-data", "核对", "开单及资金日期资料不完整", `本期 ${buckets["开单日期缺失或矛盾"].customers} 条有流水记录无法可靠分期开单，净业绩 $${money(buckets["开单日期缺失或矛盾"].netCents)}。这部分资金日期已知，已经计入本期总额，缺的是可靠的开单分期日期，不能说它没计入本月。另有 ${missingFirstAmount} 条有续充却未登记首充金额；全历史缺首充日期 $${money(missingFirstDateCents)}，缺流水日期金额 $${money(undatedRechargeCents)}，无流水日期历史余额 $${money(legacyCents)}，先于接粉/开单的事件 ${inconsistentEvents} 条。`, "先核对原始记录：缺开单日期只能暂缓分期开单客户，不影响有资金日期的收款入月；只有缺资金日期的金额才不能归收款月份。暂不据缺失记录判断哪批客户最好。");
  if (attribution["未归属或归属冲突"].customers || extras.pending || extras.ambiguous)
    warn("attribution", "核对", "投手或短信供应方归属不完整", `本期未归属或有冲突的流水记录 ${attribution["未归属或归属冲突"].customers} 条，净业绩 $${money(attribution["未归属或归属冲突"].netCents)}；所选批次待匹配 ${extras.pending}、跨组匹配冲突 ${extras.ambiguous}。`, "补齐老号码归属；这部分保留在总业绩里，不归给任何投手，不按现有投手金额直接排优劣。");
  warn("spend", "核对", "消耗完整性尚未确认", extras.spendRecords ? `本期有 ${extras.spendRecords} 条消耗记录，但系统没有完整性确认标记。` : "本期没有登记消耗，无法计算可靠的成本及回收。", "负责人核对每日消耗和币种；确认完整前，不发预算升降或成本恶化结论。");
  const gross = totals.firstCents + totals.rechargeCents;
  const top = [...rowDetails].sort((a, b) => (b.firstCents + b.rechargeCents) - (a.firstCents + a.rechargeCents)).slice(0, 3);
  const topGross = top.reduce((n, r) => n + r.firstCents + r.rechargeCents, 0);
  if (totals.customers >= 10 && gross > 0 && topGross / gross >= 0.5)
    warn("concentration", "观察", "收款集中在少数客户", `前三条客户业务记录占本期首充＋续充 ${pct(topGross, gross)}。同号跨组分行，不能据此声称三个独立客户。`, "核查对应客户后续跟进，同时观察新开单和首次续充是否接续；不要由单个大客户判断投手整体质量。");

  // Compare disjoint 14-day cohorts with identical age and fixed channel/buyer/country/group.
  // Current quality has no history, so only timestamped actions support time-window comparisons.
  const trendBuckets = new Map<string, typeof prepared>();
  for (const r of prepared) {
    const key = [r.type, r.channelId, r.buyer || "未归属", r.country || "未知国家", r.group].join("｜");
    trendBuckets.set(key, [...(trendBuckets.get(key) || []), r]);
  }
  const trends: Array<{ scope: string; metric: string; ageDays: number; currentFrom: string; currentTo: string; previousFrom: string; previousTo: string; currentN: number; previousN: number; currentHits: number; previousHits: number; comparable: boolean }> = [];
  for (const rs of trendBuckets.values()) {
    const scope = [rs[0].type === "SMS" ? "短信" : "投流", rs[0].channel, rs[0].buyer || "未归属", rs[0].country || "未知国家", rs[0].group].join("｜");
    for (const metric of ["7日回复率", "7日进群率", "7日推专家率", "30日开单率", "开单后30日续充率"] as const) {
      const ageDays = metric.startsWith("7") ? 7 : 30;
      const isRenewal = metric.startsWith("开单后");
      const end = shift(completedThrough, -(ageDays - 1));
      const currentStart = shift(end, -13), priorEnd = shift(currentStart, -1), priorStart = shift(priorEnd, -13);
      const eligible = rs.filter(r => isRenewal ? r.opened && !r.ambiguousOpening && r.amounts.firstCents > 0 : r.intake);
      const anchor = (r: typeof rs[number]) => isRenewal ? r.opened : r.intake;
      const current = eligible.filter(r => anchor(r) >= currentStart && anchor(r) <= end);
      const previousRows = eligible.filter(r => anchor(r) >= priorStart && anchor(r) <= priorEnd);
      if (!current.length && !previousRows.length) continue;
      const hit = (r: typeof rs[number]) => {
        const dates = isRenewal ? r.events.filter(e => e.kind === "recharge" && e.amountCents > 0).map(e => e.date)
          : [analysisDay(metric === "7日回复率" ? r.data.repliedOn : metric === "7日进群率" ? r.data.joinedOn : metric === "7日推专家率" ? r.data.expertOn : r.amounts.firstCents > 0 ? r.opened : "")];
        return dates.some(d => d && d >= anchor(r) && days(anchor(r), d) < ageDays);
      };
      const currentHits = current.filter(hit).length, previousHits = previousRows.filter(hit).length;
      const min = isRenewal ? 10 : 30;
      const incomplete = [...current, ...previousRows].some(r => metric === "7日回复率" ? r.data.replied === true && !analysisDay(r.data.repliedOn)
        : metric === "7日推专家率" ? r.data.addedExpert === true && !analysisDay(r.data.expertOn)
        : metric === "30日开单率" ? (r.amounts.firstCents > 0 && (!r.opened || r.ambiguousOpening)) || (r.amounts.rechargeCents > 0 && !r.amounts.firstCents)
        : isRenewal ? r.events.some(e => !e.date || e.date < r.opened) : false);
      const comparable = current.length >= min && previousRows.length >= min && rs.every(r => r.attributed) && !!rs[0].country && !incomplete;
      trends.push({ scope, metric, ageDays, currentFrom: currentStart, currentTo: end, previousFrom: priorStart, previousTo: priorEnd, currentN: current.length, previousN: previousRows.length, currentHits, previousHits, comparable });
      if (!comparable) continue;
      const a = currentHits / current.length, b = previousHits / previousRows.length;
      if (b > 0 && a <= b * 0.7 && b - a >= 0.1) {
        const action = metric === "7日回复率" ? "先检查来源质量及回复日期漏填，再对照业务接粉响应；暂不直接减投。" : metric === "30日开单率" ? "逐步检查回复、进群、推专家、注册环节，确认新开单不足来自哪里，再小范围调整。" : isRenewal ? "核对这批客户的首充与后续跟进，查看是否依赖少数大客户；不假设下月一定爆发。" : "先检查业务承接和事件日期是否漏填，对照同组其他来源；不能直接归咎于投手。";
        warn("trend:" + scope + ":" + metric, "观察", scope + " " + metric + "下降", `最近成熟批次 ${currentStart}—${end}：${currentHits}/${current.length}（${pct(currentHits, current.length)}）；前一批 ${priorStart}—${priorEnd}：${previousHits}/${previousRows.length}（${pct(previousHits, previousRows.length)}）；均观察 ${ageDays} 天。只是两个批次的差异，未验证连续多日恶化或因果。`, action);
      }
    }
  }
  return {
    range, completedThrough, comparisonRange: comparable ? { currentFrom: comparisonFrom, currentTo: comparisonTo, previousFrom, previousTo } : null,
    totals, daily, previous, comparison, buckets, types, attribution,
    cohorts: [...cohortMatrix.values()].filter(c => c.current.customers || c.previous.customers).sort((a, b) => a.month.localeCompare(b.month)),
    maturity: [...matured.values()].sort((a, b) => a.month.localeCompare(b.month) || a.windowDays - b.windowDays),
    trends, warnings, topCustomers: top, details: rowDetails.sort((a, b) => b.netCents - a.netCents),
    coverage: { businessRecords: rows.length, ...extras, eventsAfterCutoffExcluded: futureEvents, missingFirstDateCents, undatedRechargeCents, legacyCents, inconsistentEvents, missingFirstAmount },
    rules: { mode: "按需预览；未启用定时推送", minimumLeadSample: 30, minimumOpenedSample: 10, declineRelative: 0.3, declinePercentagePoints: 10, sustainedDeclineVerified: false, budgetAutomation: false },
  };
}
export type ResourceAnalysis = ReturnType<typeof analyzeResources>;

export function renderAnalysis(a: ResourceAnalysis, scope: string) {
  const lines = ["资源参谋｜资源分析日报（试运行）", `${a.range.from} 至 ${a.range.to}｜${scope}｜USD`,
    "按实际资金日期统计；同号跨小组分业务记录，不重复累计首充为新开单。", "",
    `截止日 ${a.range.to}：首充 $${money(a.daily.firstCents)}｜续充 $${money(a.daily.rechargeCents)}｜出金 $${money(a.daily.withdrawalCents)}｜净业绩 $${money(a.daily.netCents)}`,
    `所选期间：首次开单 ${a.totals.newOrders} 条｜首充 $${money(a.totals.firstCents)}｜续充 $${money(a.totals.rechargeCents)}｜出金 $${money(a.totals.withdrawalCents)}｜净业绩 $${money(a.totals.netCents)}`,
    ...Object.entries(a.types).filter(([, c]) => c.customers).map(([t, c]) => `${t === "SMS" ? "短信" : "投流"}：开单 ${c.newOrders} 条｜净业绩 $${money(c.netCents)}`),
    "", "钱来自哪批开单客户（相对截止月份）", ...Object.entries(a.buckets).map(([label, c]) => `${label}：$${money(c.netCents)}（${c.customers} 条有流水记录）`),
    "", `已归属净业绩 $${money(a.attribution["已归属"].netCents)}；未归属/冲突 $${money(a.attribution["未归属或归属冲突"].netCents)}`];
  if (a.comparisonRange) lines.push(`同期比较：${a.comparisonRange.currentFrom}—${a.comparisonRange.currentTo} $${money(a.comparison.netCents)}；${a.comparisonRange.previousFrom}—${a.comparisonRange.previousTo} $${money(a.previous.netCents)}。仅对照，不把差异直接归因于粉质量。`);
  lines.push("", "优先处理（最多3项）", ...a.warnings.slice(0, 3).map((w, i) => `${i + 1}. [${w.level}] ${w.title}\n依据：${w.evidence}\n建议：${w.action}`),
    "", `另有 ${Math.max(0, a.warnings.length - 3)} 项观察/核对事项；成熟批次对比 ${a.trends.filter(t => t.comparable).length} 项满足样本条件。`,
    `7/30/60日表现仅统计截至 ${a.completedThrough} 已满观察期的客户；截止统计日可能尚未结束。资料不足不排名，不保证下月放量。当前为一次查询预览，未判定连续恶化，未自动调整预算或业务数据。`);
  return lines.join("\n");
}
