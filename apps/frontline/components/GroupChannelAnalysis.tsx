"use client";

import { useEffect, useRef, useState } from "react";
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
type DailyReportPayload = { text: string; report: { groupName: string; reportDate: string } };

function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
function money(cents: number) { return `$${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`; }

export function GroupChannelAnalysis() {
  const detailRef = useRef<HTMLElement>(null);
  const [range, setRange] = useState<SmartDatePreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [inspection, setInspection] = useState<{kind:string;id:string}|null>(null);
  useEffect(()=>{if(inspection)detailRef.current?.scrollIntoView({block:"start"});},[inspection]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dailyReport, setDailyReport] = useState<DailyReportPayload | null>(null);
  const [reportBusy, setReportBusy] = useState<"generate" | "push" | "">("");
  const [reportMessage, setReportMessage] = useState("");
  async function load() {
    setLoading(true); setError(""); setDailyReport(null); setReportMessage(""); setInspection(null);
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
  const lawyerGroup = payload?.group.groupType === "LAWYER";
  const selected = inspection?.kind === "渠道" ? payload?.rows.find(r=>r.id===inspection.id || r.name===inspection.id) : inspection?.kind === "组员" ? payload?.members.find(r=>r.id===inspection.id) : payload?.days.find(r=>r.date===inspection?.id)?.summary;
  const detailRows = inspection?.kind === "渠道" ? payload?.rows.find(r=>r.id===inspection.id || r.name===inspection.id)?.members : inspection?.kind === "组员" ? payload?.members.find(r=>r.id===inspection.id)?.channels : payload?.days.find(r=>r.date===inspection?.id)?.rows;
  const exportHref = payload
    ? `/api/lead/channel-report-export?${new URLSearchParams({ range: "custom", sourceDateFrom: payload.range.from, sourceDateTo: payload.range.to }).toString()}`
    : "";

  return <div className="analysis-page group-summary-page">
    <section className="group-summary-unified">
    <SmartDateRangeToolbar compact range={range} from={customFrom || payload?.range.from || ""} to={customTo || payload?.range.to || ""} currentLabel={payload ? payload.range.from === payload.range.to ? payload.range.from : `${payload.range.from} 至 ${payload.range.to}` : undefined} loading={loading} title={payload?.group.name || "小组数据"} note="" actions={<>{payload ? <a className="summary-export" href={exportHref}><DownloadSimple size={15}/>导出报表</a> : null}<button className="fresh-primary" title="按区间最后一天生成，系统不会自动发送" disabled={!payload || loading || Boolean(reportBusy)} onClick={() => void generateDailyReport()}>{reportBusy === "generate" ? "生成中…" : dailyReport ? "重新生成日报" : "生成日报"}</button></>} onRange={setRange} onFrom={setCustomFrom} onTo={setCustomTo} onRefresh={() => void load()} />
    {error ? <div className="team-management__notice"><span>!</span>{error}</div> : null}
    {loading && !payload ? <section className="fresh-sheet-card analysis-loading">正在生成真实分析报告…</section> : payload ? <>
      {dailyReport || reportMessage ? <section className="fresh-sheet-card daily-report-card">

        {dailyReport ? <div className="daily-report-body"><div className="daily-report-preview"><pre>{dailyReport.text}</pre></div><div className="daily-report-actions"><button onClick={() => void copyDailyReport()}><Copy size={17} weight="bold" />复制文字</button><a href={`/api/lead/daily-business-report?date=${encodeURIComponent(dailyReport.report.reportDate)}&format=xlsx`}><DownloadSimple size={17} weight="bold" />下载 Excel</a><button data-primary="true" disabled={reportBusy === "push"} onClick={() => void pushDailyReport()}><PaperPlaneTilt size={17} weight="bold" />{reportBusy === "push" ? "正在推送…" : "推送到 Telegram"}</button></div></div> : null}
        {reportMessage ? <div className="daily-report-message">{reportMessage}</div> : null}
      </section> : null}
      <section className="analysis-kpis">{lawyerGroup ? <><article><span>接粉</span><strong>{payload.summary.totals.added}</strong><small>回复率 {percent(payload.summary.derivedRates.lawyerReplyRate)}</small></article><article><span>真实案件</span><strong>{payload.summary.totals.lawyerRealCase}</strong><small>小金额 {payload.summary.totals.lowAmount}</small></article><article><span>添加律师</span><strong>{payload.summary.totals.lawyerAdded}</strong><small>添加率 {percent(payload.summary.derivedRates.lawyerAddedRate)}</small></article><article><span>总开单</span><strong>{payload.summary.totals.ordered}</strong><small>总注册 {payload.summary.totals.registered}</small></article></> : <><article><span>添加数据</span><strong>{payload.summary.totals.added}</strong><small>有效 {payload.summary.totals.effective} · {percent(payload.summary.derivedRates.effectiveRate)}</small></article><article><span>进群</span><strong>{payload.summary.totals.joined}</strong><small>进群率 {percent(payload.summary.derivedRates.joinRate)}</small></article><article><span>开单</span><strong>{payload.summary.totals.ordered}</strong><small>开单率 {percent(payload.summary.derivedRates.orderRate)}</small></article><article><span>净业绩</span><strong>{money(payload.summary.totals.netCents)}</strong><small>首充 {money(payload.summary.totals.initialDepositCents)} · 续充 {money(payload.summary.totals.rechargeCents)}</small></article></>}</section>
      <MetricMatrixTable compact days={payload.days.map(day=>({id:day.date,name:day.date,totals:day.summary.totals}))} onInspect={(kind,id)=>setInspection({kind,id})} title={`${payload.group.name} · 数据对比`} groupType={payload.group.groupType} total={payload.summary.totals} channels={payload.rows.map((row) => ({ id: row.id ?? row.name, name: row.name, totals: row.totals }))} members={payload.members.map((row) => ({ id: row.id, name: row.name, totals: row.totals }))} />
    </> : null}
    </section>
    {payload && inspection && selected ? <section ref={detailRef} className="summary-detail"><div className="summary-detail-heading"><strong>{inspection.kind}明细 · {inspection.kind==="日期"?inspection.id:selected.name}</strong><button onClick={()=>setInspection(null)}>收起明细</button></div><MetricMatrixTable compact hideControls key={`${inspection.kind}-${inspection.id}`} title={inspection.kind==="渠道" ? "该渠道的组员数据" : "各渠道数据"} groupType={payload.group.groupType} total={selected.totals} channels={inspection.kind==="渠道"?[]:(detailRows??[]).map(r=>({id:r.id??r.name,name:r.name,totals:r.totals}))} members={inspection.kind==="渠道"?(detailRows??[]).map(r=>({id:r.id??r.name,name:r.name,totals:r.totals})):[]} /></section> : null}
    {payload ? <details className="summary-analysis"><summary>数据提示与分析{payload.summary.totals.inGroup<0 ? " · 当前在群为负数，需核对报数" : ` · ${payload.analysis.length} 条`}</summary>{payload.summary.totals.inGroup<0 ? <p>截至所选结束日期，累计退群超过累计进群。请核对历史进群和退群记录。</p> : null}{payload.analysis.map((item,index)=><p key={index}><strong>{item.title}</strong> · {item.detail}</p>)}{!payload.analysis.length ? <p>当前样本不足，暂时没有分析结论。</p> : null}</details> : null}
  </div>;
}
