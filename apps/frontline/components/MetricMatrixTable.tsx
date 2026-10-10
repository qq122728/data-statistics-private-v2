"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";

export type MatrixTotals = {
  added?: number; collision?: number; lowAmount?: number; noWs?: number; manualInvalid?: number;
  lawyerRealCase?: number; lawyerAdded?: number; lawyerExpertAdded?: number; customerServicePush?: number;
  effective?: number; replied?: number; joined?: number; left?: number; leftNormal?: number; leftAbnormal?: number;
  inGroup?: number; pushed?: number; registered?: number; ordered?: number;
  initialDepositCents?: number; rechargeCents?: number; withdrawalCents?: number; netCents?: number;
  cryptoDepositCents?: number; bankDepositCents?: number;
};

export type MatrixColumn = { id: string; name: string; sub?: string; totals: MatrixTotals };
type GroupType = "HACKER" | "LAWYER";
type Metric = { label: string; tone?: "bad" | "good" | "money" | "rate"; value: (totals: MatrixTotals) => string | number };

const count = (value: number | undefined) => value ?? 0;
const percent = (numerator: number | undefined, denominator: number | undefined) => count(denominator) > 0 ? `${(count(numerator) / count(denominator) * 100).toFixed(1)}%` : "—";
const money = (cents: number | undefined) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(count(cents) / 100);
const normalLeave = (totals: MatrixTotals) => totals.leftNormal ?? Math.max(0, count(totals.left) - count(totals.leftAbnormal));

function metricsFor(groupType: GroupType): Metric[] {
  if (groupType === "LAWYER") return [
    { label: "接粉", value: (row) => count(row.added) },
    { label: "回复", value: (row) => count(row.replied) },
    { label: "未回复", tone: "bad", value: (row) => Math.max(0, count(row.added) - count(row.replied)) },
    { label: "接粉小金额", tone: "bad", value: (row) => count(row.lowAmount) },
    { label: "接粉真实案件", tone: "good", value: (row) => count(row.lawyerRealCase) },
    { label: "回复率", tone: "rate", value: (row) => percent(row.replied, row.added) },
    { label: "添加律师", value: (row) => count(row.lawyerAdded) },
    { label: "添加专家", value: (row) => count(row.lawyerExpertAdded) },
    { label: "添加律师率", tone: "rate", value: (row) => percent(row.lawyerAdded, row.added) },
    { label: "添加专家率", tone: "rate", value: (row) => percent(row.lawyerExpertAdded, row.added) },
    { label: "总推客服数量", value: (row) => count(row.customerServicePush) },
    { label: "总注册数量", value: (row) => count(row.registered) },
    { label: "总开单数量", value: (row) => count(row.ordered) },
    { label: "加密货币充值", tone: "money", value: (row) => money(row.cryptoDepositCents) },
    { label: "银行卡充值", tone: "money", value: (row) => money(row.bankDepositCents) },
    { label: "出金", tone: "money", value: (row) => money(row.withdrawalCents) },
    { label: "净业绩", tone: "money", value: (row) => money(row.netCents) },
  ];
  return [
    { label: "添加数据", value: (row) => count(row.added) },
    { label: "撞粉", tone: "bad", value: (row) => count(row.collision) },
    { label: "低金额", tone: "bad", value: (row) => count(row.lowAmount) },
    { label: "无 WS 号码", tone: "bad", value: (row) => count(row.noWs) },
    { label: "人工无效", tone: "bad", value: (row) => count(row.manualInvalid) },
    { label: "有效数据", tone: "good", value: (row) => count(row.effective) },
    { label: "回复", value: (row) => count(row.replied) },
    { label: "回复率", tone: "rate", value: (row) => percent(row.replied, row.effective) },
    { label: "进群", value: (row) => count(row.joined) },
    { label: "进群率", tone: "rate", value: (row) => percent(row.joined, row.effective) },
    { label: "正常退群", value: normalLeave },
    { label: "异常退群", tone: "bad", value: (row) => count(row.leftAbnormal) },
    { label: "异常退群率", tone: "rate", value: (row) => percent(row.leftAbnormal, count(row.joined) - normalLeave(row)) },
    { label: "当前在群", tone: "good", value: (row) => count(row.inGroup) },
    { label: "推专家", value: (row) => count(row.pushed) },
    { label: "注册", value: (row) => count(row.registered) },
    { label: "注册率", tone: "rate", value: (row) => percent(row.registered, row.pushed) },
    { label: "开单", value: (row) => count(row.ordered) },
    { label: "开单率", tone: "rate", value: (row) => percent(row.ordered, row.registered) },
    { label: "首充", tone: "money", value: (row) => money(row.initialDepositCents) },
    { label: "续充", tone: "money", value: (row) => money(row.rechargeCents) },
    { label: "出金", tone: "money", value: (row) => money(row.withdrawalCents) },
    { label: "净业绩", tone: "money", value: (row) => money(row.netCents) },
  ];
}

export function MetricMatrixTable({ title, groupType, total, channels, members, onClose, compact = false, days = [], onInspect, hideControls = false }: { hideControls?: boolean; days?: MatrixColumn[]; onInspect?: (kind: string, id: string) => void; compact?: boolean; title: string; groupType: GroupType; total: MatrixTotals; channels: MatrixColumn[]; members: MatrixColumn[]; onClose?: () => void }) {
  const [scope, setScope] = useState<"all" | "channel" | "member" | "day">("all");
  const [search, setSearch] = useState("");
  const originalMetrics = metricsFor(groupType);
  const metrics = compact ? originalMetrics.filter(m => m.tone !== "rate") : originalMetrics;
  const candidates = scope === "day" && compact ? days.map(row=>({...row,sub:"日期"})) : [...(compact && scope === "member" ? [] : channels).map(row=>({...row,sub:"渠道"})), ...(compact && scope === "channel" ? [] : members).map(row=>({...row,sub:"组员"}))];
  const columns = [{id:"total",name:"合计",sub:hideControls?"当前明细":"全组",totals:total},...candidates.filter(row=>!compact || row.name.toLowerCase().includes(search.trim().toLowerCase()))];
  function renderTable(items: Metric[]) {
    return <table aria-label="小组数量和金额" style={{ minWidth: Math.max(760, 170 + columns.length * 116), tableLayout: compact ? "fixed" : undefined }}>
      <colgroup><col style={{width:170}}/>{columns.map(column=><col key={`${column.sub}-${column.id}`}/>)}</colgroup>
      <thead><tr><th>数据指标</th>{columns.map(column=><th key={`${column.sub}-${column.id}`}>{onInspect && column.id!=="total" ? <button className="matrix-drill" title="点击查看明细" onClick={()=>onInspect(column.sub,column.id)}>{column.name}<span aria-hidden="true"> ↗</span></button> : <strong>{column.name}</strong>}<small>{column.sub}</small></th>)}</tr></thead>
      {items.map(metric=><tbody key={metric.label}>
        {compact && [groupType==="LAWYER"?"接粉":"添加数据", groupType==="LAWYER"?"添加律师":"回复", groupType==="LAWYER"?"加密货币充值":"首充"].includes(metric.label) ? <tr className="matrix-section"><th colSpan={columns.length+1}>{metric.tone==="money" ? "资金数据 · USD" : ["回复","添加律师"].includes(metric.label) ? "客户跟进" : "添加与有效数据"}</th></tr> : null}
        <tr data-tone={metric.tone}><th>{metric.label}</th>{columns.map(column=><td key={`${column.sub}-${column.id}`}>{metric.value(column.totals)}</td>)}</tr>
      </tbody>)}
    </table>;
  }

  return <section className="fresh-sheet-card metric-matrix-card" data-compact={compact}>
    <div className="fresh-sheet-title"><div><h2>{title}</h2>{!compact ? <p>左侧是指标，横向同时对比合计、渠道和组员</p> : null}</div>{compact && !hideControls ? <div className="analysis-switch" aria-label="对比范围"><input aria-label="搜索对比列" placeholder={scope==="day"?"搜索日期":"搜索渠道或组员"} value={search} onChange={e=>setSearch(e.target.value)}/>{([['all','全部'],['channel','按渠道'],['member','按组员'],['day','按日期']] as const).map(([key,label])=><button key={key} aria-pressed={scope===key} data-active={scope===key} onClick={()=>{setScope(key);setSearch("");}}>{label}</button>)}</div> : onClose ? <button type="button" className="metric-matrix-close" onClick={onClose}>收起明细</button> : <span className="metric-matrix-live">实时汇总</span>}</div>
    {compact && columns.length===1 ? <p className="matrix-empty">{search ? "没有匹配的项目，合计仍为全组数据。" : "这个范围暂无明细。"}</p> : null}
    {compact ? <div className="metric-matrix-scroll compact-rates"><table aria-label="小组渠道与组员比率"><thead><tr><th>渠道 / 组员</th>{originalMetrics.filter(m=>m.tone==="rate").map(m=><th key={m.label}>{m.label}</th>)}</tr></thead><tbody>{columns.map(column=><tr key={`${column.sub}-${column.id}`} data-total={column.id==="total"}><th>{column.name}<small>{column.sub}</small></th>{originalMetrics.filter(m=>m.tone==="rate").map(m=><td key={m.label}>{m.value(column.totals)}</td>)}</tr>)}</tbody></table></div> : null}
    <div className="metric-matrix-scroll matrix-data-scroll">{renderTable(metrics)}</div>
    <footer>金额为 USD；比率自动计算。当前在群为截至结束日期累计，其他数量为所选区间发生数。搜索仅筛选显示列，合计不随搜索改变。</footer>
  </section>;
}

type OrgReport = { groups: Array<{ id: string; name: string; groupType: GroupType; totals: MatrixTotals }>; channels: Array<MatrixColumn & { groupType: GroupType }>; members: Array<MatrixColumn & { groupId: string; groupType: GroupType }> };

export function OrgGroupMetricMatrix({ groupId, groupName, groupType, range, from, to, onClose }: { groupId: string; groupName: string; groupType: GroupType; range: string; from: string; to: string; onClose: () => void }) {
  const [report, setReport] = useState<OrgReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setReport(null); setError("");
    const query = new URLSearchParams({ range, groupId });
    if (range === "custom") { query.set("sourceDateFrom", from); query.set("sourceDateTo", to); }
    void requestJson<OrgReport>(`/api/org/reporting?${query}`).then((value) => { if (!cancelled) setReport(value); }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "小组矩阵读取失败"); });
    return () => { cancelled = true; };
  }, [from, groupId, range, to]);
  if (error) return <section className="fresh-sheet-card metric-matrix-state">{error}<button type="button" onClick={onClose}>关闭</button></section>;
  if (!report) return <section className="fresh-sheet-card metric-matrix-state">正在读取 {groupName} 的渠道和组员明细…</section>;
  const group = report.groups.find((row) => row.id === groupId);
  return <MetricMatrixTable title={`${groupName} · 数据矩阵`} groupType={groupType} total={group?.totals ?? {}} channels={report.channels.filter((row) => row.groupType === groupType)} members={report.members.filter((row) => row.groupId === groupId && row.groupType === groupType)} onClose={onClose} />;
}
