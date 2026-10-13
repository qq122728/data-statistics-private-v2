import { resourcePerformance } from "./performance";
import { investmentSummary } from "../../../packages/customer-sheet/investment";
import type { SheetData } from "../../../packages/customer-sheet/schema";
import { finance, abilities } from "../../../packages/customer-sheet/bot-insights";

export type AnalysisRow = {
  id: string; phone: string; group: string; channel: string; channelId: string;
  type: string; buyer: string; country: string; material: string;
  attributed: boolean; data: SheetData;
};
export type Cash = { firstCents: number; rechargeCents: number; withdrawalCents: number; netCents: number; customers: number; newOrders: number };
export type Warning = { key: string; level: "严重预警"; title: string; evidence: string; action: string };
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
  rows = rows.filter(r => r.attributed && !!r.buyer);
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
  const buckets: Record<string, Cash> = { "本月开单": cash(), "上月开单": cash(), "更早开单": cash(), "其他开单批次": cash() };
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
      ? "其他开单批次" : opened.slice(0, 7) === month ? "本月开单" : opened.slice(0, 7) === previousMonth ? "上月开单" : "更早开单";
    add(totals, range.from, range.to); add(daily, range.to, range.to);
    add(buckets[bucket], range.from, range.to); add(types[row.type] ??= cash(), range.from, range.to);
    add(attribution[row.attributed ? "已归属" : "未归属或归属冲突"], range.from, range.to);
    if (comparable) { add(previous, previousFrom, previousTo); add(comparison, comparisonFrom, comparisonTo); }
    const detail = cash(); add(detail, range.from, range.to);
    if (detail.customers) rowDetails.push({ phone: row.phone, group: row.group, channel: row.channel, buyer: row.buyer || "未归属", country: row.country || "未知", intakeOn: intake, openedOn: opened, bucket, ...detail });
    const cohort = ambiguousOpening ? "其他开单批次" : opened.slice(0, 7);
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
  const { dailyPerformance, performance, trends, warnings } = resourcePerformance(rows, range, completedThrough);
  const sourceKeys = [...new Set(rows.map(r => JSON.stringify([r.type,r.channelId,r.buyer,r.country])))];
  // Match the existing resource trend's recorded-date semantics, including legacy orderedOn.
  const insightValue=(r:AnalysisRow)=>({data:{...r.data,channelId:r.data.channelId||r.channelId,replied:!!analysisDay(r.data.repliedOn),addedExpert:!!analysisDay(r.data.expertOn),firstDepositOn:analysisDay(r.data.firstDepositOn||r.data.orderedOn)}});
  const sources = sourceKeys.map(key => {
    const sourceRows=rows.filter(r=>JSON.stringify([r.type,r.channelId,r.buyer,r.country])===key);
    const first=sourceRows[0], values=sourceRows.map(insightValue);
    const financial=finance(values,range.from,range.to);
    const quality=abilities(values,completedThrough).filter(m=>['reply','join','register','leadOrder','renew','renewAmount'].includes(m.key)).map(m=>({key:m.key,label:m.label,n:m.current.n,hits:m.current.hits,value:m.current.n>=m.minimum?m.current.value:null,from:m.current.from,to:m.current.to}));
    const currentFirst=comparable?finance(values,comparisonFrom,comparisonTo):null,previousFirst=comparable?finance(values,previousFrom,previousTo):null;
    if(currentFirst&&previousFirst&&currentFirst.orders>=10&&previousFirst.orders>=10&&previousFirst.averageFirst!>0){
      const decline=(previousFirst.averageFirst!-currentFirst.averageFirst!)/previousFirst.averageFirst!;
      if(decline>=0.1-1e-10)warnings.push({key:'average-first:'+key,level:'严重预警',title:`${first.channel}｜${first.buyer}｜${first.country} 平均首充下降${(decline*100).toFixed(1)}%`,evidence:`${previousFrom}—${previousTo} $${money(previousFirst.averageFirst!)}（${previousFirst.orders}人）→ ${comparisonFrom}—${comparisonTo} $${money(currentFirst.averageFirst!)}（${currentFirst.orders}人）。`,action:'按承接小组和专家核对首充结构，来源结构变化不直接等同投手能力下降。'});
    }
    return {type:first.type,channel:first.channel,buyer:first.buyer,country:first.country,financial,quality};
  }).sort((a,b)=>b.financial.orders-a.financial.orders||b.financial.rechargeCents-a.financial.rechargeCents);
  const financial=finance(rows.map(insightValue),range.from,range.to);
  const top = [...rowDetails].sort((a, b) => b.netCents - a.netCents).slice(0, 3);
  return {
    range, completedThrough, comparisonRange: comparable ? { currentFrom: comparisonFrom, currentTo: comparisonTo, previousFrom, previousTo } : null,
    totals, daily, previous, comparison, buckets, types, attribution,
    cohorts: [...cohortMatrix.values()].filter(c => c.current.customers || c.previous.customers).sort((a, b) => a.month.localeCompare(b.month)),
    maturity: [...matured.values()].sort((a, b) => a.month.localeCompare(b.month) || a.windowDays - b.windowDays),
    dailyPerformance, performance, trends, warnings, financial, sources, topCustomers: top, details: rowDetails.sort((a, b) => b.netCents - a.netCents),
    coverage: { businessRecords: rows.length, ...extras, eventsAfterCutoffExcluded: futureEvents, missingFirstDateCents, undatedRechargeCents, legacyCents, inconsistentEvents, missingFirstAmount },
    rules: { mode: "按需查询＋随各国小组收工日报自动推送", minimumLeadSample: 30, minimumOpenedSample: 10, declineRelative: 0.1, sustainedDeclineVerified: false, budgetAutomation: false },
  };
}
export type ResourceAnalysis = ReturnType<typeof analyzeResources>;

export function renderAnalysis(a: ResourceAnalysis, scope: string) {
  const p = a.performance;
  if (!p.recordCount) return `资源参谋｜${scope}\n${a.range.from} 至 ${a.range.to}\n本次暂无可分析的效果记录。`;
  const lines = ["资源参谋｜资源效果分析", `${a.range.from} 至 ${a.range.to}｜${scope}｜USD`,
    "范围：已匹配到投手或短信供应方的号码。数量、金额按实际发生日期；转化率按同龄批次。", "",
    `回复 ${p.replies}｜进群 ${p.joins}｜引专家 ${p.introductions}｜注册 ${p.registrations}｜开单 ${p.orders}`,
    `续充 $${money(p.rechargeCents)}｜首充 $${money(a.totals.firstCents)}｜净业绩 $${money(a.totals.netCents)}`];
  lines.push(`平均首充 ${a.financial.averageFirst===null?'—':'$'+money(a.financial.averageFirst)}｜本月粉开单 ${a.financial.intake.current.orders}｜以前粉开单 ${a.financial.intake.old.orders}`,
    `续充 ${a.financial.renewed}人｜续充人均 ${a.financial.averageRecharge===null?'—':'$'+money(a.financial.averageRecharge)}`);
  const rates = a.trends.filter(t => t.comparison === "批次环比" && t.unit === "rate" && t.scope.endsWith("全部国家"));
  if (rates.length) lines.push("", "同龄转化（每项均标明观察窗口）", ...rates.slice(0, 6).map(t => `${t.scope} ${t.metric}：${pct(t.currentHits, t.currentN)}（${t.currentHits}/${t.currentN}）；前批 ${pct(t.previousHits, t.previousN)}`));
  const known = Object.entries(a.buckets).filter(([k, c]) => k !== "其他开单批次" && c.customers);
  if (known.length) lines.push("", "本期续充来自哪批客户", ...known.map(([k, c]) => `${k}：续充 $${money(c.rechargeCents)}`));
  lines.push("", `严重预警 ${a.warnings.length} 项（相对下降达到10%）`, ...a.warnings.slice(0, 3).map((w, i) => `${i + 1}. ${w.title}\n依据：${w.evidence}\n建议：${w.action}`));
  if (!a.warnings.length) lines.push("本次可比数据未触发严重预警。");
  lines.push("", `预警使用截至 ${a.completedThrough} 的完整统计日；月环比对上月同段，同比对去年同段；同龄批次分别满7/30天后比较。每日随小组收工推送分析；本报告不自动调整预算。`);
  return lines.join("\n");
}
