"use client";

import { useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import { SmartDateRangeToolbar, type SmartDatePreset } from "@/components/SmartDateRangeToolbar";
import { Copy, DownloadSimple, PaperPlaneTilt } from "@phosphor-icons/react";
import { MetricMatrixTable } from "@/components/MetricMatrixTable";

type Totals = { added: number; collision: number; lowAmount: number; noWs: number; manualInvalid: number; lawyerRealCase: number; lawyerAdded: number; lawyerExpertAdded: number; customerServicePush: number; effective: number; replied: number; joined: number; left: number; leftAbnormal: number; inGroup: number; pushed: number; registered: number; ordered: number; initialDepositCents: number; rechargeCents: number; withdrawalCents: number; netCents: number; cryptoDepositCents: number; bankDepositCents: number };
type Rates = { effectiveRate: number | null; replyRate: number | null; joinRate: number | null; registrationRate: number | null; orderRate: number | null; abnormalLeaveRate: number | null; lawyerReplyRate: number | null; lawyerAddedRate: number | null; lawyerExpertAddedRate: number | null };
type Slice = { id?: string; name: string; totals: Totals; derivedRates: Rates };
type Channel = Slice & { members: Array<Slice & { id: string }> };
type Member = Slice & { id: string; channels: Array<Slice & { id: string }> };
type Day = { date: string; summary: Slice; rows: Channel[] };
type Payload = { group: { name: string; groupType: "HACKER" | "LAWYER" }; range: { today: string; from: string; to: string; label: string }; summary: Slice; rows: Channel[]; members: Member[]; days: Day[]; analysis: Array<{ tone: "good" | "warn" | "info"; title: string; detail: string }> };
type Mode = "member" | "channel" | "day";
type ViewRow = Slice & { key: string; children: Slice[] };
type DailyReportPayload = { text: string; report: { groupName: string; reportDate: string } };

function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
function money(cents: number) { return `$${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }

type Column = { label: string; value: (row: Slice) => string | number; strong?: boolean };
const hackerColumns: Column[] = [
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

const lawyerColumns: Column[] = [
  { label: "接粉", value: (row) => row.totals.added }, { label: "回复", value: (row) => row.totals.replied },
  { label: "未回复", value: (row) => Math.max(0, row.totals.added - row.totals.replied) }, { label: "接粉小金额", value: (row) => row.totals.lowAmount },
  { label: "接粉真实案件", value: (row) => row.totals.lawyerRealCase }, { label: "回复率", value: (row) => percent(row.derivedRates.lawyerReplyRate) },
  { label: "添加律师", value: (row) => row.totals.lawyerAdded }, { label: "添加专家", value: (row) => row.totals.lawyerExpertAdded },
  { label: "添加律师率", value: (row) => percent(row.derivedRates.lawyerAddedRate) }, { label: "添加专家率", value: (row) => percent(row.derivedRates.lawyerExpertAddedRate) },
  { label: "总推客服", value: (row) => row.totals.customerServicePush }, { label: "总注册", value: (row) => row.totals.registered },
  { label: "总开单", value: (row) => row.totals.ordered }, { label: "加密货币充值", value: (row) => money(row.totals.cryptoDepositCents) },
  { label: "银行卡充值", value: (row) => money(row.totals.bankDepositCents) }, { label: "出金", value: (row) => money(row.totals.withdrawalCents) },
];

function MetricCells({ row, columns }: { row: Slice; columns: Column[] }) {
  return <>{columns.map((column) => <td key={column.label}>{column.strong ? <strong>{column.value(row)}</strong> : column.value(row)}</td>)}</>;
}

export function GroupChannelAnalysis() {
  const [range, setRange] = useState<SmartDatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [mode, setMode] = useState<Mode>("member");
  const [expanded, setExpanded] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dailyReport, setDailyReport] = useState<DailyReportPayload | null>(null);
  const [reportBusy, setReportBusy] = useState<"generate" | "push" | "">("");
  const [reportMessage, setReportMessage] = useState("");
  async function load() {
    setLoading(true); setError(""); setDailyReport(null); setReportMessage("");
    const params = new URLSearchParams({ range });
    if (range === "custom") {
      params.set("sourceDateFrom", customFrom || payload?.range.from || "");
      params.set("sourceDateTo", customTo || payload?.range.to || "");
    }
    try {
      const next = await requestJson<Payload>(`/api/lead/channel-reporting?${params.toString()}`);
      setPayload(next);
      if (range === "custom") { setCustomFrom(next.range.from); setCustomTo(next.range.to); }
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "分析报告读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (range !== "custom") void load(); }, [range]);
  async function generateDailyReport() {
    if (!payload) return;
    setReportBusy("generate"); setReportMessage("");
    try {
      const next = await requestJson<DailyReportPayload>(`/api/lead/daily-business-report?date=${encodeURIComponent(payload.range.to)}`);
      setDailyReport(next);
    } catch (caught) { setReportMessage(caught instanceof Error ? caught.message : "日报生成失败"); }
    finally { setReportBusy(""); }
  }
  async function copyDailyReport() {
    if (!dailyReport) return;
    await navigator.clipboard.writeText(dailyReport.text);
    setReportMessage("日报文字已复制");
  }
  async function pushDailyReport() {
    if (!payload || !dailyReport) return;
    if (!window.confirm(`确认把 ${dailyReport.report.groupName} ${dailyReport.report.reportDate} 的文字和 Excel 推送到 Telegram？`)) return;
    setReportBusy("push"); setReportMessage("");
    try {
      const result = await requestJson<{ message: string }>("/api/lead/daily-business-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: payload.range.to }) });
      setReportMessage(result.message);
    } catch (caught) { setReportMessage(caught instanceof Error ? caught.message : "Telegram 推送失败"); }
    finally { setReportBusy(""); }
  }
  const rows = useMemo<ViewRow[]>(() => {
    if (!payload) return [];
    if (mode === "member") return payload.members.map((row) => ({ ...row, key: row.id, children: row.channels }));
    if (mode === "channel") return payload.rows.map((row) => ({ ...row, key: row.id ?? row.name, children: row.members }));
    return payload.days.map((day) => ({ ...day.summary, name: day.date, key: day.date, children: day.rows }));
  }, [mode, payload]);
  const firstColumn = mode === "member" ? "业绩归属成员" : mode === "channel" ? "渠道" : "日期";
  const title = mode === "member" ? "个人归属数据汇总" : mode === "channel" ? "渠道数据汇总" : "每日数据汇总";
  const lawyerGroup = payload?.group.groupType === "LAWYER";
  const columns = lawyerGroup ? lawyerColumns : hackerColumns;
  const note = mode === "member"
    ? "每名组员只显示一行；后续进群、注册、开单和资金统一归最初来源组员，点击可展开分渠道"
    : mode === "channel" ? "先看渠道全组合计，点击一行展开归属成员" : "每天一行显示本组合计，点击可展开当天各渠道";
  const exportHref = payload
    ? `/api/lead/channel-report-export?${new URLSearchParams({ range: "custom", sourceDateFrom: payload.range.from, sourceDateTo: payload.range.to }).toString()}`
    : "";

  return <div className="analysis-page">
    <SmartDateRangeToolbar range={range} from={customFrom || payload?.range.from || ""} to={customTo || payload?.range.to || ""} currentLabel={payload ? payload.range.from === payload.range.to ? payload.range.from : `${payload.range.from} 至 ${payload.range.to}` : undefined} loading={loading} title="小组日报＋渠道数据汇总" note="组长确认数据后手动生成，可下载 Excel 或推送到 Telegram；系统不会自动推送" onRange={setRange} onFrom={setCustomFrom} onTo={setCustomTo} onRefresh={() => void load()} />
    {error ? <div className="team-management__notice"><span>!</span>{error}</div> : null}
    {loading && !payload ? <section className="fresh-sheet-card analysis-loading">正在生成真实分析报告…</section> : payload ? <>
      <section className="fresh-sheet-card daily-report-card">
        <div className="fresh-sheet-title"><div><h2>小组业务日报</h2><p>先由组长确认当天数据，再手动生成、下载或推送；系统不会自动发送。</p></div><button className="fresh-primary" disabled={Boolean(reportBusy)} onClick={() => void generateDailyReport()}>{reportBusy === "generate" ? "生成中…" : dailyReport ? "重新生成" : "生成日报"}</button></div>
        {dailyReport ? <div className="daily-report-body"><div className="daily-report-preview"><pre>{dailyReport.text}</pre></div><div className="daily-report-actions"><button onClick={() => void copyDailyReport()}><Copy size={17} weight="bold" />复制文字</button><a href={`/api/lead/daily-business-report?date=${encodeURIComponent(dailyReport.report.reportDate)}&format=xlsx`}><DownloadSimple size={17} weight="bold" />下载 Excel</a><button data-primary="true" disabled={reportBusy === "push"} onClick={() => void pushDailyReport()}><PaperPlaneTilt size={17} weight="bold" />{reportBusy === "push" ? "正在推送…" : "推送到 Telegram"}</button></div></div> : <div className="daily-report-empty">先选好日期，再点“生成日报”。系统会自动整理人员、渠道、当日和当月数据。</div>}
        {reportMessage ? <div className="daily-report-message">{reportMessage}</div> : null}
      </section>
      <section className="analysis-kpis">{lawyerGroup ? <><article><span>接粉</span><strong>{payload.summary.totals.added}</strong><small>回复率 {percent(payload.summary.derivedRates.lawyerReplyRate)}</small></article><article><span>真实案件</span><strong>{payload.summary.totals.lawyerRealCase}</strong><small>小金额 {payload.summary.totals.lowAmount}</small></article><article><span>添加律师</span><strong>{payload.summary.totals.lawyerAdded}</strong><small>添加率 {percent(payload.summary.derivedRates.lawyerAddedRate)}</small></article><article><span>总开单</span><strong>{payload.summary.totals.ordered}</strong><small>总注册 {payload.summary.totals.registered}</small></article></> : <><article><span>添加数据</span><strong>{payload.summary.totals.added}</strong><small>有效 {payload.summary.totals.effective} · {percent(payload.summary.derivedRates.effectiveRate)}</small></article><article><span>进群</span><strong>{payload.summary.totals.joined}</strong><small>进群率 {percent(payload.summary.derivedRates.joinRate)}</small></article><article><span>开单</span><strong>{payload.summary.totals.ordered}</strong><small>开单率 {percent(payload.summary.derivedRates.orderRate)}</small></article><article><span>净业绩</span><strong>{money(payload.summary.totals.netCents)}</strong><small>首充 {money(payload.summary.totals.initialDepositCents)} · 续充 {money(payload.summary.totals.rechargeCents)}</small></article></>}</section>
      <MetricMatrixTable title={`${payload.group.name} · 组内数据矩阵`} groupType={payload.group.groupType} total={payload.summary.totals} channels={payload.rows.map((row) => ({ id: row.id ?? row.name, name: row.name, totals: row.totals }))} members={payload.members.map((row) => ({ id: row.id, name: row.name, totals: row.totals }))} />
      <section className="analysis-insights"><header><div><h2>智能分析结论</h2><p>{payload.group.name} · {payload.range.from} 至 {payload.range.to} · 每条结论都能回到下面表格核对</p></div></header><div>{payload.analysis.length ? payload.analysis.map((item, index) => <article key={`${item.title}-${index}`} data-tone={item.tone}><i>{item.tone === "good" ? "✓" : item.tone === "warn" ? "!" : "i"}</i><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>) : <article data-tone="info"><i>i</i><div><strong>当前样本还不足</strong><p>继续填写每日数据后，系统会自动生成渠道和人员对比。</p></div></article>}</div></section>
      <section className="fresh-sheet-card analysis-table-card"><div className="fresh-sheet-title"><div><h2>{title}</h2><p>{note}</p></div><div className="analysis-table-actions"><div className="analysis-switch"><button data-active={mode === "member"} onClick={() => { setMode("member"); setExpanded(""); }}>按归属人员看</button><button data-active={mode === "channel"} onClick={() => { setMode("channel"); setExpanded(""); }}>按渠道看</button><button data-active={mode === "day"} onClick={() => { setMode("day"); setExpanded(""); }}>按日期看</button></div><a className="analysis-export" href={exportHref}><DownloadSimple size={16} weight="bold" />导出当前报表</a></div></div><div className="analysis-table-wrap"><table style={{ minWidth: lawyerGroup ? 1800 : 2260 }}><thead><tr><th>{firstColumn}</th>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>{rows.map((row) => <tbody key={row.key} className="analysis-row-group"><tr onClick={() => setExpanded(expanded === row.key ? "" : row.key)}><td><button aria-label={`${expanded === row.key ? "收起" : "展开"}${row.name}明细`}>{expanded === row.key ? "−" : "+"}</button><strong>{row.name}</strong></td><MetricCells row={row} columns={columns} /></tr>{expanded === row.key ? row.children.map((child) => <tr className="analysis-child" key={child.id || child.name}><td>↳ {child.name}</td><MetricCells row={child} columns={columns} /></tr>) : null}</tbody>)}<tfoot><tr><td><strong>合计</strong></td><MetricCells row={payload.summary} columns={columns} /></tr></tfoot></table></div></section>
    </> : null}
  </div>;
}
