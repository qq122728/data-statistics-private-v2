import { investmentSummary } from "../../../packages/customer-sheet/investment";
import { analysisDay, type AnalysisRow, type Warning } from "./analysis";
const dayMs = 86400000;
const shift = (s: string, n: number) => new Date(Date.parse(s) + n * dayMs).toISOString().slice(0, 10);
const inside = (s: string, from: string, to: string) => !!s && s >= from && s <= to;
const priorDate = (s: string, months: number) => {
  const d = new Date(s); const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1));
  const max = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(max, d.getUTCDate())); return target.toISOString().slice(0, 10);
};
// Align calendar periods, then trim both to the same number of elapsed days.
function periods(from: string, to: string, months: number) {
  const pf = priorDate(from, months), pt = priorDate(to, months);
  const duration = Math.min((Date.parse(to) - Date.parse(from)) / dayMs, (Date.parse(pt) - Date.parse(pf)) / dayMs);
  return { currentFrom: from, currentTo: shift(from, duration), previousFrom: pf, previousTo: shift(pf, duration) };
}
export type PerformanceTrend = {
  scope: string; metric: string; comparison: string; unit: "rate" | "count" | "USD";
  sampleBasis: string; ageDays: number; currentFrom: string; currentTo: string; previousFrom: string; previousTo: string;
  currentN: number; previousN: number; currentHits: number; previousHits: number;
  currentValue: number; previousValue: number; declineRelative: number | null; comparable: boolean;
};
const display = (v: number, unit: PerformanceTrend["unit"]) => unit === "rate" ? (v * 100).toFixed(1) + "%" : unit === "USD" ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v);

export function resourcePerformance(input: AnalysisRow[], range: { from: string; to: string }, completedThrough: string) {
  const rows = input.filter(r => r.attributed && r.buyer).map(r => {
    const amounts = investmentSummary(r.data);
    return { ...r, intake: analysisDay(r.data.intakeOn), opened: analysisDay(r.data.firstDepositOn || r.data.orderedOn),
      replied: analysisDay(r.data.repliedOn), joined: analysisDay(r.data.joinedOn), expert: analysisDay(r.data.expertOn), registered: analysisDay(r.data.registeredOn), amounts };
  });
  const dated = (rs: typeof rows, from: string, to: string) => ({
    replies: rs.filter(r => inside(r.replied, from, to)).length,
    joins: rs.filter(r => inside(r.joined, from, to)).length,
    introductions: rs.filter(r => inside(r.expert, from, to)).length,
    registrations: rs.filter(r => inside(r.registered, from, to)).length,
    orders: rs.filter(r => r.amounts.firstCents > 0 && inside(r.opened, from, to)).length,
    rechargeCents: rs.reduce((sum, r) => sum + r.amounts.entries.filter(e => e.kind !== "withdrawal" && inside(analysisDay(e.date), from, to)).reduce((n, e) => n + e.amountCents, 0), 0),
  });
  const groups = new Map<string, typeof rows>();
  // First assess each buyer, then each country. Do not fragment small samples by business team.
  for (const r of rows) {
    const buyer = [r.type === "SMS" ? "短信" : "投流", r.channel, r.buyer].join("｜");
    for (const key of [buyer + "｜全部国家", ...(r.country ? [buyer + "｜" + r.country] : [])]) {
      // channel IDs prevent equally named independent channels from being merged.
      const id = r.channelId + "|" + key;
      const group = groups.get(id) || []; group.push(r); groups.set(id, group);
    }
  }
  const trends: PerformanceTrend[] = [], warnings: Warning[] = [];
  const add = (t: PerformanceTrend) => {
    if (!t.comparable) return; // No comparable baseline: quietly skip it.
    t.declineRelative = t.previousValue > 0 ? (t.previousValue - t.currentValue) / t.previousValue : null;
    trends.push(t);
    if (t.declineRelative === null || t.declineRelative + 1e-12 < 0.1) return;
    const rate = t.unit === "rate";
    const action = t.metric.includes("续充") ? "查看上月及更早开单客户的续充跟进，区分续充人数与大额客户金额变化。"
      : t.metric.includes("回复") ? "对比该来源接粉量与业务响应，定位回复下降发生在哪些批次。"
      : t.metric.includes("开单") ? "沿进群、引专家、注册逐步定位转化下降，先小范围验证调整。"
      : "对照接粉量和业务承接，查看进群、引专家、注册之间哪一环下滑。";
    warnings.push({ key: ["trend", t.scope, t.metric, t.comparison].join(":"), level: "严重预警", title: `${t.scope} ${t.metric}${t.comparison}下降`,
      evidence: `${t.currentFrom}—${t.currentTo}：${display(t.currentValue, t.unit)}${rate ? `（${t.currentHits}/${t.currentN}）` : ""}；对照 ${t.previousFrom}—${t.previousTo}：${display(t.previousValue, t.unit)}${rate ? `（${t.previousHits}/${t.previousN}）` : ""}；相对下降 ${(t.declineRelative * 100).toFixed(1)}%。${t.ageDays ? `两批均观察 ${t.ageDays} 天。` : "按实际发生日期、相同天数比较；数量或金额变化不等于转化质量变化。"}`, action });
  };
  const end = range.to < completedThrough ? range.to : completedThrough;
  for (const [id, rs] of groups) {
    const scope = id.slice(id.indexOf("|") + 1);
    // Actual business volume and cash, comparing complete equal-length calendar periods.
    if (range.from <= end) for (const [months, comparison] of [[1, "月环比"], [12, "同比"]] as const) {
      const p = periods(range.from, end, months), current = dated(rs, p.currentFrom, p.currentTo), previous = dated(rs, p.previousFrom, p.previousTo);
      for (const [key, metric] of [["replies", "回复数量"], ["introductions", "引专家数量"], ["orders", "开单数量"], ["rechargeCents", "续充金额"]] as const) {
        const renewal = key === "rechargeCents";
        const cohort = (from: string, to: string) => rs.filter(r => renewal
          ? !!r.opened && r.opened <= to && r.amounts.firstCents > 0
          : !!r.intake && r.intake <= to);
        const cn = cohort(p.currentFrom, p.currentTo).length, pn = cohort(p.previousFrom, p.previousTo).length;
        const payers = rs.filter(r => r.amounts.entries.some(e => e.kind !== "withdrawal" && e.amountCents > 0 && inside(analysisDay(e.date), p.previousFrom, p.previousTo))).length;
        // A baseline of >=10 actions/payers avoids single-customer percentage alarms; zero current activity can still alert.
        const comparable = renewal ? cn >= 10 && pn >= 10 && payers >= 10 : previous[key] >= 10;
        add({ scope, metric, comparison, unit: renewal ? "USD" : "count", ageDays: 0, ...p,
          sampleBasis: renewal ? "currentN/previousN为两期期末已开单存量，非两期新增开单数" : "currentN/previousN为两期各自新接粉量；数量指标按实际事件日期，不以接粉量作分母",
          currentN: renewal ? cn : rs.filter(r => inside(r.intake, p.currentFrom, p.currentTo)).length,
          previousN: renewal ? pn : rs.filter(r => inside(r.intake, p.previousFrom, p.previousTo)).length,
          currentHits: current[key], previousHits: previous[key], currentValue: current[key] / (renewal ? 100 : 1), previousValue: previous[key] / (renewal ? 100 : 1), comparable, declineRelative: null });
      }
    }
    // Same-age conversion: recent mature 14-day batches vs previous batch/month/year.
    for (const [metric, ageDays, anchorKey, eventKey] of [
      ["7日回复率", 7, "intake", "replied"], ["7日进群率", 7, "intake", "joined"],
      ["引专家后7日注册转化率", 7, "expert", "registered"], ["30日开单率", 30, "intake", "opened"],
      ["开单后30日人均续充金额", 30, "opened", "renewal"],
      ["开单后30日续充率", 30, "opened", "renewalRate"],
    ] as const) {
      const ce = shift(end, -(ageDays - 1)), cf = shift(ce, -13);
      const windows = [
        { comparison: "批次环比", currentFrom: cf, currentTo: ce, previousFrom: shift(cf, -14), previousTo: shift(ce, -14) },
        ...([[1, "月环比"], [12, "同比"]] as const).map(([months, comparison]) => ({ comparison, ...periods(cf, ce, months) })),
      ];
      for (const p of windows) {
        const valid = rs.filter(r => r[anchorKey] && (anchorKey !== "opened" || (r.amounts.firstCents > 0 && (!r.intake || r.opened >= r.intake))));
        const current = valid.filter(r => inside(r[anchorKey], p.currentFrom, p.currentTo));
        const previous = valid.filter(r => inside(r[anchorKey], p.previousFrom, p.previousTo));
        const renewal = eventKey === "renewal" || eventKey === "renewalRate";
        const value = (r: typeof rows[number]) => {
          const start = r[anchorKey], finish = shift(start, ageDays - 1);
          if (renewal) {const selected=r.amounts.entries.filter(e => e.kind !== "withdrawal" && inside(analysisDay(e.date), start, finish));return eventKey==='renewalRate'?Number(selected.some(e=>e.amountCents>0)):selected.reduce((n,e)=>n+e.amountCents,0)/100;}
          return Number((eventKey !== "opened" || r.amounts.firstCents > 0) && inside(r[eventKey], start, finish));
        };
        const ch = current.reduce((n, r) => n + value(r), 0), ph = previous.reduce((n, r) => n + value(r), 0);
        // Inconsistent timestamps invalidate this comparison silently, rather than reporting missing-data warnings.
        const inconsistent = [...current, ...previous].some(r => eventKey === "replied" ? r.data.replied === true && !r.replied
          : eventKey === "opened" ? r.amounts.firstCents > 0 && !r.opened
          : renewal ? r.amounts.entries.some(e => !analysisDay(e.date) || e.date < r.opened)
          : eventKey === "registered" ? r.data.registered === true && !r.registered : false);
        const min = renewal ? 10 : 30;
        add({ scope, metric, ...p, unit: eventKey==='renewal' ? "USD" : "rate", sampleBasis: renewal ? "观察满30天的首次开单客户数" : anchorKey === "expert" ? "观察满7天的引专家人数" : `观察满${ageDays}天的接粉人数`, ageDays, currentN: current.length, previousN: previous.length,
          currentHits: ch, previousHits: ph, currentValue: current.length ? ch / current.length : 0, previousValue: previous.length ? ph / previous.length : 0,
          comparable: current.length >= min && previous.length >= min && !inconsistent, declineRelative: null });
      }
    }
  }
  trends.sort((a, b) => (b.declineRelative ?? -Infinity) - (a.declineRelative ?? -Infinity));
  // Avoid reporting a country's identical evidence twice when a buyer operates in only one country.
  const seen = new Set<string>();
  const uniqueWarnings = warnings.filter(w => { const k = w.title.split("｜").slice(0, 3).join("｜") + w.title.slice(w.title.lastIndexOf(" ")) + w.evidence;
    if (seen.has(k)) return false; seen.add(k); return true; });
  uniqueWarnings.sort((a, b) => Number(b.evidence.match(/相对下降 ([\d.]+)/)?.[1] || 0) - Number(a.evidence.match(/相对下降 ([\d.]+)/)?.[1] || 0));
  return { dailyPerformance: dated(rows, range.to, range.to), performance: { recordCount: rows.length, ...dated(rows, range.from, range.to) }, trends, warnings: uniqueWarnings };
}
