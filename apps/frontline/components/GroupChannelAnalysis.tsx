"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";

type Totals = { added: number; collision: number; lowAmount: number; noWs: number; manualInvalid: number; effective: number; replied: number; joined: number; left: number; leftAbnormal: number; inGroup: number; pushed: number; registered: number; ordered: number; initialDepositCents: number; rechargeCents: number; withdrawalCents: number; netCents: number };
type Rates = { effectiveRate: number | null; replyRate: number | null; joinRate: number | null; registrationRate: number | null; orderRate: number | null; abnormalLeaveRate: number | null };
type Slice = { id?: string; name: string; totals: Totals; derivedRates: Rates };
type Channel = Slice & { members: Array<Slice & { id: string }> };
type Member = Slice & { id: string; channels: Array<Slice & { id: string }> };
type Day = { date: string; summary: Slice; rows: Channel[] };
type Payload = { group: { name: string }; range: { from: string; to: string; label: string }; summary: Slice; rows: Channel[]; members: Member[]; days: Day[]; analysis: Array<{ tone: "good" | "warn" | "info"; title: string; detail: string }> };
type Mode = "member" | "channel" | "day";
type ViewRow = Slice & { key: string; children: Slice[] };

function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
function money(cents: number) { return `$${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }

const columns: Array<{ label: string; value: (row: Slice) => string | number; strong?: boolean }> = [
  { label: "添加", value: (row) => row.totals.added }, { label: "撞粉", value: (row) => row.totals.collision },
  { label: "低金额", value: (row) => row.totals.lowAmount }, { label: "无 WS", value: (row) => row.totals.noWs },
  { label: "人工无效", value: (row) => row.totals.manualInvalid }, { label: "有效", value: (row) => row.totals.effective },
  { label: "回复", value: (row) => row.totals.replied }, { label: "进群", value: (row) => row.totals.joined },
  { label: "正常退群", value: (row) => Math.max(0, row.totals.left - row.totals.leftAbnormal) }, { label: "异常退群", value: (row) => row.totals.leftAbnormal },
  { label: "当前在群", value: (row) => row.totals.inGroup }, { label: "推专家", value: (row) => row.totals.pushed },
  { label: "注册", value: (row) => row.totals.registered }, { label: "开单", value: (row) => row.totals.ordered },
  { label: "首充", value: (row) => money(row.totals.initialDepositCents) }, { label: "续充", value: (row) => money(row.totals.rechargeCents) },
  { label: "出金", value: (row) => money(row.totals.withdrawalCents) }, { label: "净业绩", value: (row) => money(row.totals.netCents), strong: true },
  { label: "回复率", value: (row) => percent(row.derivedRates.replyRate) }, { label: "进群率", value: (row) => percent(row.derivedRates.joinRate) },
  { label: "异常退群率", value: (row) => percent(row.derivedRates.abnormalLeaveRate) }, { label: "注册率", value: (row) => percent(row.derivedRates.registrationRate) },
  { label: "开单率", value: (row) => percent(row.derivedRates.orderRate) },
];

function MetricCells({ row }: { row: Slice }) {
  return <>{columns.map((column) => <td key={column.label}>{column.strong ? <strong>{column.value(row)}</strong> : column.value(row)}</td>)}</>;
}

export function GroupChannelAnalysis() {
  const [range, setRange] = useState("month");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [mode, setMode] = useState<Mode>("member");
  const [expanded, setExpanded] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try { setPayload(await requestJson<Payload>(`/api/lead/channel-reporting?range=${range}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "分析报告读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [range]);
  const rows = useMemo<ViewRow[]>(() => {
    if (!payload) return [];
    if (mode === "member") return payload.members.map((row) => ({ ...row, key: row.id, children: row.channels }));
    if (mode === "channel") return payload.rows.map((row) => ({ ...row, key: row.id ?? row.name, children: row.members }));
    return payload.days.map((day) => ({ ...day.summary, name: day.date, key: day.date, children: day.rows }));
  }, [mode, payload]);
  const firstColumn = mode === "member" ? "业绩归属成员" : mode === "channel" ? "渠道" : "日期";
  const title = mode === "member" ? "个人归属数据汇总" : mode === "channel" ? "渠道数据汇总" : "每日数据汇总";
  const note = mode === "member"
    ? "每名组员只显示一行；后续进群、注册、开单和资金统一归最初来源组员，点击可展开分渠道"
    : mode === "channel" ? "先看渠道全组合计，点击一行展开归属成员" : "每天一行显示本组合计，点击可展开当天各渠道";

  return <div className="analysis-page">
    <div className="fresh-toolbar"><div className="fresh-history-intro"><strong>小组渠道数据汇总＋智能分析</strong><span>统计只读取已经生效的每日数据，历史调组不会改写原小组报表</span></div><label><span>统计周期</span><select value={range} onChange={(event) => setRange(event.target.value)}><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="month">本月</option><option value="lastMonth">上月</option></select></label><button className="fresh-primary" onClick={() => void load()}>刷新报告</button></div>
    {error ? <div className="team-management__notice"><span>!</span>{error}</div> : null}
    {loading && !payload ? <section className="fresh-sheet-card analysis-loading">正在生成真实分析报告…</section> : payload ? <>
      <section className="analysis-kpis"><article><span>添加数据</span><strong>{payload.summary.totals.added}</strong><small>有效 {payload.summary.totals.effective} · {percent(payload.summary.derivedRates.effectiveRate)}</small></article><article><span>进群</span><strong>{payload.summary.totals.joined}</strong><small>进群率 {percent(payload.summary.derivedRates.joinRate)}</small></article><article><span>开单</span><strong>{payload.summary.totals.ordered}</strong><small>开单率 {percent(payload.summary.derivedRates.orderRate)}</small></article><article><span>净业绩</span><strong>{money(payload.summary.totals.netCents)}</strong><small>首充 {money(payload.summary.totals.initialDepositCents)} · 续充 {money(payload.summary.totals.rechargeCents)}</small></article></section>
      <section className="analysis-insights"><header><div><h2>智能分析结论</h2><p>{payload.group.name} · {payload.range.from} 至 {payload.range.to} · 每条结论都能回到下面表格核对</p></div></header><div>{payload.analysis.length ? payload.analysis.map((item, index) => <article key={`${item.title}-${index}`} data-tone={item.tone}><i>{item.tone === "good" ? "✓" : item.tone === "warn" ? "!" : "i"}</i><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>) : <article data-tone="info"><i>i</i><div><strong>当前样本还不足</strong><p>继续填写每日数据后，系统会自动生成渠道和人员对比。</p></div></article>}</div></section>
      <section className="fresh-sheet-card analysis-table-card"><div className="fresh-sheet-title"><div><h2>{title}</h2><p>{note}</p></div><div className="analysis-switch"><button data-active={mode === "member"} onClick={() => { setMode("member"); setExpanded(""); }}>按归属人员看</button><button data-active={mode === "channel"} onClick={() => { setMode("channel"); setExpanded(""); }}>按渠道看</button><button data-active={mode === "day"} onClick={() => { setMode("day"); setExpanded(""); }}>按日期看</button></div></div><div className="analysis-table-wrap"><table style={{ minWidth: 2260 }}><thead><tr><th>{firstColumn}</th>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>{rows.map((row) => <tbody key={row.key} className="analysis-row-group"><tr onClick={() => setExpanded(expanded === row.key ? "" : row.key)}><td><button aria-label={`${expanded === row.key ? "收起" : "展开"}${row.name}明细`}>{expanded === row.key ? "−" : "+"}</button><strong>{row.name}</strong></td><MetricCells row={row} /></tr>{expanded === row.key ? row.children.map((child) => <tr className="analysis-child" key={child.id || child.name}><td>↳ {child.name}</td><MetricCells row={child} /></tr>) : null}</tbody>)}<tfoot><tr><td><strong>合计</strong></td><MetricCells row={payload.summary} /></tr></tfoot></table></div></section>
    </> : null}
  </div>;
}
