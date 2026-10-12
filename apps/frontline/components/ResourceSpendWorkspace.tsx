"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";
import { COUNTRIES } from "../../../packages/resource-buyer/options";
import { ResourceBuyerCostTable } from "./ResourceBuyerCostTable";
import { ResourceBuyerSpend } from "./ResourceBuyerSpend";
import type { BuyerPayload } from "./ResourceBuyerAttribution";
import styles from "./ResourceBuyerAttribution.module.css";
export function ResourceSpendWorkspace({ smsOnly = false, readOnly = false, active = true }: { smsOnly?: boolean; readOnly?: boolean; active?: boolean }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [channel, setChannel] = useState("");
  const [country, setCountry] = useState("");
  const [payload, setPayload] = useState<BuyerPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (targetMonth = month) => {
    const current = ++sequence.current; setLoading(true); setError("");
    const query = new URLSearchParams({ month: targetMonth });
    if (channel) query.set("channelId", channel); if (country) query.set("country", country);
    try { const data = await requestJson<BuyerPayload>(`/api/resource/buyer-phones?${query}`); if (current === sequence.current) setPayload(data); }
    catch (caught) { if (current === sequence.current) setError(caught instanceof Error ? caught.message : "无法读取消耗记录"); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [month, channel, country]);
  useEffect(() => { if (active) void load(); }, [active, load]);
  return <div className={styles.stack}>
    <section className={styles.intro}><div><h2>{readOnly ? "查看资源消耗" : "记录每天的投放消耗"}</h2><p>{readOnly ? "查看投流与短信部门的消耗记录，按国家和渠道核对。" : smsOnly ? "这里登记一次，短信粉效果表会自动计算消耗与客户成本。" : "这里登记一次，投手效果表会自动计算消耗与客户成本。"}</p></div><button type="button" disabled={loading} onClick={() => void load()}>{loading ? "正在刷新…" : "刷新记录"}</button></section>
    <section className={styles.card} aria-label="消耗记录筛选"><div className={styles.filters}>
      <label>记录月份<input type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} /></label>
      <label>记录渠道<select value={channel} onChange={e => setChannel(e.target.value)}><option value="">全部授权渠道</option>{payload?.channels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>记录国家<select value={country} onChange={e => setCountry(e.target.value)}><option value="">全部国家</option>{COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    </div></section>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {!payload && loading ? <p role="status">正在读取消耗记录…</p> : null}
    <ResourceBuyerCostTable smsOnly={smsOnly} rows={payload?.summary ?? []} loading={loading} />
    <ResourceBuyerSpend smsOnly={smsOnly} payload={payload} readOnly={readOnly} historyOpen onSaved={async savedMonth => { setMonth(savedMonth); await load(savedMonth); }} />
  </div>;
}
