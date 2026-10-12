"use client";
import { useState } from 'react';
import { requestJson } from '@/lib/backend';
import { COUNTRIES, CURRENCIES, countryName, parseSpendCents } from '../../../packages/resource-buyer/options';
import type { BuyerPayload } from './ResourceBuyerAttribution';
import { spendMoney } from './resource-buyer-format';
import styles from './ResourceBuyerAttribution.module.css';
export type SpendEntry = { id: string; channelId: string; channel: string; buyer: string; country: string; spendDate: string; materialId: string | null; material: string; currency: string; amountCents: number; note: string };
export function ResourceBuyerSpend({smsOnly = false,payload,readOnly,onSaved,historyOpen = false}: {smsOnly?: boolean; payload: BuyerPayload | null; readOnly: boolean; historyOpen?: boolean; onSaved: (month: string) => Promise<void>}) {
  const [channelId,setChannel] = useState(''); const [buyer,setBuyer] = useState(''); const [country,setCountry] = useState(''); const [materialId,setMaterial] = useState('');
  const [spendDate,setDate] = useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
  const [currency,setCurrency] = useState('USD'); const [amount,setAmount] = useState(''); const [note,setNote] = useState(''); const [busy,setBusy] = useState(false); const [message,setMessage] = useState(''); const [error,setError] = useState('');
  const usesMaterials = !smsOnly && payload?.channels.find(channel => channel.id === channelId)?.channelType === "ADS";
  const showMaterialHistory = !smsOnly && !!payload?.channels.some(channel => channel.channelType === "ADS");
  const materials = payload?.materials.filter(item=>item.channelId===channelId && item.buyer.name===buyer.trim()) ?? [];
  const existing = payload?.spends.find(item=>item.channelId===channelId && item.buyer===buyer.trim() && item.country===country && item.spendDate===spendDate && (item.materialId || '')===materialId && item.currency===currency);
  async function save() {
    setBusy(true);setError('');setMessage('');
    try {
      const result = await requestJson<{updated:boolean}>('/api/resource/buyer-spend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId,buyer,country,spendDate,materialId: usesMaterials ? materialId : "",currency,amount,note})});
      setMessage(result.updated ? '已更新这一天的消耗，没有重复累加。' : '消耗已保存。'); await onSaved(spendDate.slice(0,7));
    } catch(e) {setError(e instanceof Error ? e.message : '保存失败');} finally {setBusy(false);}
  }
  function edit(row: SpendEntry) {setChannel(row.channelId);setBuyer(row.buyer);setCountry(row.country);setDate(row.spendDate);setMaterial(row.materialId || '');setCurrency(row.currency);setAmount((row.amountCents/100).toFixed(2));setNote(row.note);setMessage('已载入记录，修改金额后保存。');setError('');}
  return <section className={styles.card} aria-label="消耗登记"><header><h3>{readOnly ? '消耗记录' : '消耗登记'}</h3><p>{showMaterialHistory ? "按日期、渠道、投手、国家、素材及币种保存当日金额。同一组合重复保存会更新原金额，不会累加。未指定素材只填写未分摊部分，避免与素材消耗重复。" : "按日期、渠道、供粉方、国家及币种保存当日金额。同一组合重复保存会更新原金额，不会累加。"}</p></header>
    {!readOnly ? <><div className={styles.formGrid}>
      <label>消耗渠道<select value={channelId} onChange={e=>{setChannel(e.target.value);setBuyer('');setMaterial('');}}><option value="">请选择渠道</option>{payload?.channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>{smsOnly ? "消耗供粉方" : "消耗投手／供粉方"}<input value={buyer} maxLength={100} list="spend-buyers" onChange={e=>{setBuyer(e.target.value);setMaterial('');}} /><datalist id="spend-buyers">{payload?.buyers.filter(b=>b.channelId===channelId).map(b=><option key={b.id} value={b.name}/>)}</datalist></label>
      <label>消耗国家<select value={country} onChange={e=>setCountry(e.target.value)}><option value="">请选择国家</option>{COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <label>消耗日期<input type="date" value={spendDate} onChange={e=>setDate(e.target.value)}/></label>
      {usesMaterials ? <label>消耗素材（选填）<select value={materialId} onChange={e=>setMaterial(e.target.value)}><option value="">未指定素材／未分摊</option>{materials.map(m=><option key={m.id} value={m.id}>{m.name}{m.active ? '' : '（已停用）'}</option>)}</select></label> : null}
      <label>币种<select value={currency} onChange={e=>setCurrency(e.target.value)}>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label>当日消耗金额<input type="number" min="0" max="20000000" step="0.01" placeholder="例如 100.00" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <label>消耗备注（选填）<input maxLength={300} value={note} onChange={e=>setNote(e.target.value)}/></label>
    </div>{existing ? <p className={styles.importHint}>已有记录：{spendMoney(existing.amountCents,existing.currency)}。保存将替换该金额。</p> : null}<div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || !channelId || !country || !buyer.trim() || !spendDate || parseSpendCents(amount)===null} onClick={()=>void save()}>{busy ? '保存中…' : '保存当日消耗'}</button></div>{message ? <p role="status" className={styles.success}>{message}</p> : null}{error ? <p role="alert" className={styles.error}>{error}</p> : null}</> : null}
    <details className={styles.spendHistory} open={historyOpen || undefined}><summary>查看消耗记录 · {payload?.spends.length ?? 0} 条（按上方月份、渠道、国家筛选）</summary><div className={styles.tableWrap}><table><thead><tr><th>日期</th><th>渠道</th><th>{smsOnly ? "供粉方" : "投手／供粉方"}</th><th>国家</th>{showMaterialHistory ? <th>素材</th> : null}<th>金额</th><th>备注</th>{!readOnly ? <th>操作</th> : null}</tr></thead><tbody>{payload?.spends.map(row=><tr key={row.id}><td>{row.spendDate}</td><td>{row.channel}</td><td>{row.buyer}</td><td>{countryName(row.country)}</td>{showMaterialHistory ? <td>{row.material || '未指定／未分摊'}</td> : null}<td>{spendMoney(row.amountCents,row.currency)}</td><td>{row.note || '—'}</td>{!readOnly ? <td><button type="button" onClick={()=>edit(row)}>修改</button></td> : null}</tr>)}{!payload?.spends.length ? <tr><td colSpan={6 + (showMaterialHistory ? 1 : 0) + (readOnly ? 0 : 1)} className={styles.empty}>当前筛选下尚未登记消耗</td></tr> : null}</tbody></table></div></details>
  </section>;
}
