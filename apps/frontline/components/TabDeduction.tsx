"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";
import { IconCheck, IconMinus, IconPlus } from "./Icons";

type ImportOptions = { today: string; channels: Array<{ id: string; name: string }> };
type InvalidReport = {
  id: string; status: "PENDING" | "APPROVED" | "RETURNED";
  noWsCount: number; lowAmountCount: number; collisionCount: number;
  approvedNoWsCount: number | null; approvedLowAmountCount: number | null; approvedCollisionCount: number | null;
  reviewReason: string | null;
  batch: { sourceDate: string; channel: { id: string; name: string } };
};

const STATUS_META = {
  APPROVED: { tone: "ok" as const, label: "组长已通过" },
  PENDING: { tone: "warn" as const, label: "等待组长审核" },
  RETURNED: { tone: "bad" as const, label: "被退回" },
};

function Counter({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (n: number) => void }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 18px", background: "var(--surface-sunken)", border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
    <div><p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{label}</p><p style={{ margin: "1px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>{hint}</p></div>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button className="btn" type="button" style={{ width: 36, padding: 0 }} onClick={() => onChange(Math.max(0, value - 1))} aria-label={`减少${label}`}><IconMinus size={16} /></button>
      <span className="tnum" style={{ minWidth: 34, textAlign: "center", fontSize: 19, fontWeight: 700 }}>{value}</span>
      <button className="btn" type="button" style={{ width: 36, padding: 0 }} onClick={() => onChange(value + 1)} aria-label={`增加${label}`}><IconPlus size={16} /></button>
    </div>
  </div>;
}

export function TabDeduction({ onToast }: { onToast: (msg: string, tone?: "ok" | "warn") => void }) {
  const [options, setOptions] = useState<ImportOptions | null>(null);
  const [reports, setReports] = useState<InvalidReport[]>([]);
  const [channelId, setChannelId] = useState("");
  const [dup, setDup] = useState(0);
  const [low, setLow] = useState(0);
  const [noWs, setNoWs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const total = dup + low + noWs;

  async function load() {
    try {
      const [optionPayload, reportPayload] = await Promise.all([
        requestJson<ImportOptions>("/api/reception/import-options"),
        requestJson<{ reports: InvalidReport[] }>("/api/invalid-fan-reports"),
      ]);
      setOptions(optionPayload);
      setChannelId((current) => current || optionPayload.channels[0]?.id || "");
      setReports(reportPayload.reports);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取扣粉记录失败");
    }
  }

  useEffect(() => { void load(); }, []);

  async function submit() {
    if (!options || !channelId || total === 0) return;
    setBusy(true); setError("");
    try {
      await requestJson("/api/invalid-fan-reports", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, sourceDate: options.today, collisionCount: dup, lowAmountCount: low, noWsCount: noWs, action: "report" }),
      });
      setDup(0); setLow(0); setNoWs(0);
      await load();
      onToast("已真实提交，等待组长审核");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交失败，请稍后重试");
    } finally { setBusy(false); }
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <div className="card">
      <div className="card-head"><div><h2 className="card-title">今日扣粉登记</h2><p className="card-note">这三类只报数量，不建客户档案。提交后由组长审核，通过后才进入正式统计。</p></div><span className="badge" data-tone="mute">{options?.today ?? "读取中…"}</span></div>
      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ maxWidth: 420 }}><label className="label">来源渠道</label><select className="field field-lg" style={{ width: "100%" }} value={channelId} onChange={(event) => setChannelId(event.target.value)}>{!options?.channels.length ? <option value="">暂无可用渠道</option> : null}{options?.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}><Counter label="撞粉" hint="号码之前已经有人录过" value={dup} onChange={setDup} /><Counter label="低金额" hint="低于当前渠道的有效金额标准" value={low} onChange={setLow} /><Counter label="无 WhatsApp" hint="客户没有可用 WhatsApp 号码" value={noWs} onChange={setNoWs} /></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}><p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>合计报 <strong className="tnum" style={{ fontSize: 16, color: "var(--ink)" }}>{total}</strong> 条</p><button className="btn" data-variant="primary" data-size="lg" disabled={total === 0 || !channelId || busy} onClick={() => void submit()}><IconCheck size={17} />{busy ? "正在提交…" : "提交给组长审核"}</button></div>
      </div>
    </div>
    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}</div> : null}
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-head"><div><h2 className="card-title">登记记录</h2><p className="card-note">这里只显示当前账号真实提交过的记录；被退回后可按同一天、同一渠道重新提交。</p></div><button className="btn" data-size="sm" onClick={() => void load()}>刷新</button></div>
      <div className="table-scroll"><table className="grid-table"><thead><tr><th>日期</th><th>渠道</th><th className="num">撞粉</th><th className="num">低金额</th><th className="num">无 WS</th><th className="num">合计</th><th>状态</th><th>组长说明</th></tr></thead><tbody>
        {!reports.length ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 30, color: "var(--ink-3)" }}>还没有扣粉登记。</td></tr> : null}
        {reports.map((report) => { const collision = report.status === "APPROVED" ? report.approvedCollisionCount ?? report.collisionCount : report.collisionCount; const lowAmount = report.status === "APPROVED" ? report.approvedLowAmountCount ?? report.lowAmountCount : report.lowAmountCount; const noNumber = report.status === "APPROVED" ? report.approvedNoWsCount ?? report.noWsCount : report.noWsCount; const meta = STATUS_META[report.status]; return <tr key={report.id} data-tone={report.status === "RETURNED" ? "bad" : undefined}><td>{report.batch.sourceDate}</td><td>{report.batch.channel.name}</td><td className="num">{collision}</td><td className="num">{lowAmount}</td><td className="num">{noNumber}</td><td className="num" style={{ fontWeight: 700 }}>{collision + lowAmount + noNumber}</td><td><span className="badge" data-tone={meta.tone}>{meta.label}</span></td><td style={{ color: "var(--ink-2)" }}>{report.reviewReason || <span className="muted">—</span>}</td></tr>; })}
      </tbody></table></div>
    </div>
  </div>;
}
