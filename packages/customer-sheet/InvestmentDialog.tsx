"use client";
import { useRef, useState } from "react";
import type { SheetRow } from "./schema";
import { fieldActionNumber } from "./action-numbers";
import { investmentSummary, type Recharge } from "./investment";
import { monthDay } from "./month-day";
import MonthDaySelect from "./MonthDaySelect";
import styles from "./CustomerSheet.module.css";
import { requestJson } from "./request-error";
export default function InvestmentDialog({row,onClose,onSaved,readOnlyReason}:{row:SheetRow;onClose:()=>void;onSaved:()=>Promise<void>;readOnlyReason?:string}){
 const [current,setCurrent]=useState(row);
 const [amount,setAmount]=useState("");const [date,setDate]=useState("");const [method,setMethod]=useState("bank");
 const [editingId,setEditingId]=useState<string|null>(null);
 const [pendingDelete,setPendingDelete]=useState<Recharge|null>(null);
 const [kind,setKind]=useState("recharge");
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const requestId=useRef<string|null>(null);
 const summary=investmentSummary(current.data);const editable=row.editable.includes("investmentTotal");
 const money=(cents:number)=>(cents/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError("");
  try{requestId.current??=crypto.randomUUID();const result=await requestJson<Pick<SheetRow,"version"|"data"|"editable">>(`/api/customer-sheet/rows/${row.id}/recharges`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:current.version,requestId:requestId.current,amount:Number(amount),date,method,kind,replace:!!editingId})},"保存资金流水");setCurrent(r=>({...r,...result}));setAmount("");setDate("");setEditingId(null);requestId.current=null;await onSaved();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function remove(){
  if(busy||!pendingDelete)return;const id=pendingDelete.id;
  setBusy(true);setError("");
  try{const result=await requestJson<Pick<SheetRow,"version"|"data"|"editable">>(`/api/customer-sheet/rows/${row.id}/recharges`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({version:current.version,requestId:id})},"删除资金流水");setCurrent(r=>({...r,...result}));setPendingDelete(null);if(editingId===id){setEditingId(null);requestId.current=null;setAmount("");setDate("");}await onSaved();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className={styles.overlay}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label="投资总额与续充明细"><header><h3>{row.phone} · 投资总额</h3><button aria-label="关闭续充弹窗" disabled={busy} onClick={onClose}>×</button></header>
  <div className={styles.investmentSummary}><strong>{money(summary.totalCents)}</strong><span>首充 {money(summary.firstCents)} ＋ 续充 {money(summary.rechargeCents)}{summary.baseCents>0?` ＋ 期初金额 ${money(summary.baseCents)}`:""}</span></div>
  {error&&<p className={styles.inlineError} role="alert">{error}</p>}
  {pendingDelete&&<div className={styles.deleteConfirm} role="alertdialog" aria-label="确认删除资金流水"><strong>确定永久删除这笔资金流水？</strong><span>{monthDay(pendingDelete.date)} · {pendingDelete.kind==="withdrawal"?"出金":"续充"} · {money(pendingDelete.amountCents)}</span><small>删除后会自动重算客户总额和业绩，不能在系统内恢复。</small><div><button disabled={busy} onClick={()=>setPendingDelete(null)}>取消</button><button className={styles.dangerButton} disabled={busy} onClick={()=>void remove()}>{busy?"删除中…":"永久删除"}</button></div></div>}
  {editable?<form onSubmit={save}><h4>{editingId?"修改资金流水":"新增资金流水"}</h4><label>类型<select aria-label="流水类型" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value);requestId.current=editingId;}}><option value="recharge">续充</option><option value="withdrawal">出金</option></select></label><div className={styles.formGrid}><label>流水金额<input autoFocus aria-label="流水金额" type="number" min="0.01" step="0.01" required value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value);requestId.current=editingId;}}/></label><label>发生日期<MonthDaySelect label="发生日期" value={date} disabled={busy} onChange={v=>{setDate(v);requestId.current=editingId;}}/></label><label>支付方式<select aria-label="支付方式" disabled={busy} value={method} onChange={e=>{setMethod(e.target.value);requestId.current=editingId;}}><option value="bank">银行卡</option><option value="crypto">加密货币</option></select></label></div><footer>{editingId&&<button type="button" disabled={busy} onClick={()=>{setEditingId(null);requestId.current=null;setAmount("");setDate("");}}>取消修改</button>}<button className={styles.primary} disabled={busy||!date||!amount}>{busy?"保存中…":"保存流水"}</button></footer></form>:<p className={styles.inlineHint}>{readOnlyReason||"只读：仅这位客户当前指定且具备专家岗位的专家负责人可以修改资金流水。"}</p>}
  <h4>资金记录 · {summary.entries.length} 笔</h4><div className={styles.rechargeList}><table><thead><tr><th>编号</th><th>日期</th><th>类型</th><th>方式</th><th>金额</th><th>操作</th></tr></thead><tbody>{[...summary.entries].reverse().map(r=><tr key={r.id}><td>{fieldActionNumber(current.data,r.id)||"—"}</td><td title={r.date}>{monthDay(r.date)}</td><td>{r.kind==="withdrawal"?"出金":"续充"}</td><td>{r.method==="bank"?"银行卡":"加密货币"}</td><td>{money(r.amountCents)}</td><td>{editable&&<span className={styles.rechargeActions}><button disabled={busy} onClick={()=>{setEditingId(r.id);requestId.current=r.id;setAmount(String(r.amountCents/100));setDate(r.date);setMethod(r.method);setKind(r.kind||"recharge");}}>修改</button><button className={styles.trashButton} aria-label={`删除 ${fieldActionNumber(current.data,r.id)||monthDay(r.date)} 资金流水`} title="永久删除这笔资金流水" disabled={busy} onClick={()=>setPendingDelete(r)}>🗑</button></span>}</td></tr>)}</tbody></table>{!summary.entries.length&&<p>暂无资金记录</p>}</div>
 </section></div>;
}
