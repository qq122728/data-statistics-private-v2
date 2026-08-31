"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";

type Entry = { id: string; reviewDate: string; channelName: string; normalizedName: string; group: { id: string; name: string } };
type ReportRow = { channel: { normalizedName: string }; group: { id: string }; totals: { added: number; effective: number; replied: number; joined: number; pushed: number; registered: number; ordered: number; depositCents: number; withdrawalCents: number } };
type Row = Entry & { totals: ReportRow["totals"] };
const zero = { added: 0, effective: 0, replied: 0, joined: 0, pushed: 0, registered: 0, ordered: 0, depositCents: 0, withdrawalCents: 0 };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function RealResourceInbox() {
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notes, setNotes] = useState<Record<string, string>>({}); const [saving, setSaving] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const entries = (await requestJson<{ entries: Entry[] }>("/api/resource/channel-review")).entries;
      const dates = [...new Set(entries.map((entry) => entry.reviewDate))];
      const reports = await Promise.all(dates.map(async (date) => ({ date, rows: (await requestJson<{ rows: ReportRow[] }>(`/api/resource/reporting?range=custom&sourceDateFrom=${date}&sourceDateTo=${date}`)).rows })));
      setRows(entries.map((entry) => ({ ...entry, totals: reports.find((report) => report.date === entry.reviewDate)?.rows.find((row) => row.group.id === entry.group.id && row.channel.normalizedName === entry.normalizedName)?.totals ?? zero })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "核对收件箱加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function review(row: Row, decision: "CONFIRM" | "DISPUTE") {
    const note = notes[row.id]?.trim() ?? ""; if (decision === "DISPUTE" && !note) { setError("标记异议时必须写清楚哪里不对"); return; }
    setSaving(row.id); setError(""); try { await requestJson(`/api/resource/channel-review/${encodeURIComponent(row.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, ...(note ? { note } : {}) }) }); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "处理核对失败"); } finally { setSaving(""); }
  }
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}><section className="card"><div className="card-head"><div><h2 className="card-title">核对收件箱</h2><p className="card-note">只显示组长真正发来的待办；确认后不能撤销，异议说明会原样返回组长。</p></div><button className="btn" data-size="sm" onClick={() => void load()}>刷新</button></div>{error ? <div style={{ padding: "12px 16px", color: "var(--bad)" }}>{error}</div> : null}<div className="table-scroll"><table className="grid-table" data-sticky-edges="true" style={{ minWidth: 1400 }}><thead><tr><th>日期 / 小组 / 渠道</th><th>添加</th><th>有效</th><th>回复</th><th>进群</th><th>推专家</th><th>注册</th><th>开单</th><th>入金</th><th>出金</th><th>处理</th></tr></thead><tbody>{loading ? <tr><td colSpan={11} style={{ padding: 40, textAlign: "center" }}>正在读取组长提交的数据…</td></tr> : null}{!loading && !rows.length ? <tr><td colSpan={11} style={{ padding: 46, textAlign: "center", color: "var(--ink-3)" }}>暂无组长提交的核对数据</td></tr> : null}{rows.map((row) => <tr key={row.id}><td><strong>{row.reviewDate} · {row.channelName}</strong><div className="muted">{row.group.name}</div></td><td className="num">{row.totals.added}</td><td className="num">{row.totals.effective}</td><td className="num">{row.totals.replied}</td><td className="num">{row.totals.joined}</td><td className="num">{row.totals.pushed}</td><td className="num">{row.totals.registered}</td><td className="num">{row.totals.ordered}</td><td className="num">{money(row.totals.depositCents)}</td><td className="num">{money(row.totals.withdrawalCents)}</td><td><div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 230 }}><input className="field" placeholder="有异议时写具体原因" value={notes[row.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} /><div style={{ display: "flex", gap: 6 }}><button className="btn" data-size="sm" data-variant="primary" disabled={saving === row.id} onClick={() => void review(row, "CONFIRM")}>确认无误</button><button className="btn" data-size="sm" disabled={saving === row.id} onClick={() => void review(row, "DISPUTE")}>标记异议</button></div></div></td></tr>)}</tbody></table></div></section></div>;
}
