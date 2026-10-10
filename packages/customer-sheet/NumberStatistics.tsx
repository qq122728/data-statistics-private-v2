"use client";
import {useEffect,useState} from 'react';
import {numberMetrics,type NumberValues} from './number-statistics';
import MonthDaySelect from './MonthDaySelect';
import styles from './CustomerSheet.module.css';
import {requestJson} from './request-error';
type Result={canViewGroup:boolean;scope:'self'|'group';today:string;from:string;to:string;total:NumberValues;channels:{id:string;name:string;values:NumberValues}[]};
export default function NumberStatistics({groupId}:{groupId:string}){
 const [basis,setBasis]=useState('event');const [from,setFrom]=useState('');const [to,setTo]=useState('');const [mine,setMine]=useState(false);const [result,setResult]=useState<Result|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function load(){setBusy(true);setError('');try{const p=new URLSearchParams({groupId,basis,mine:mine?'1':'0'});if(from)p.set('from',from);if(to)p.set('to',to);const data=await requestJson<Result>(`/api/customer-sheet/statistics?${p}`,undefined,'查询号码统计');setResult(data);setFrom(data.from);setTo(data.to);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{void load();},[groupId,basis,mine]);
 const text=(key:string,value:number)=>key.endsWith('Cents')?`$${(value/100).toFixed(2)}`:String(value);
 return <section><div className={styles.toolbar}><select aria-label="统计日期口径" value={basis} onChange={e=>setBasis(e.target.value)}><option value="event">按发生日期</option><option value="intake">按接粉日期看转化</option></select><MonthDaySelect label="统计开始" value={from} onChange={setFrom}/><MonthDaySelect label="统计结束" value={to} onChange={setTo}/><strong>{result ? (result.scope==='self'?'本人统计':'全组统计') : '正在确认统计范围…'}</strong>{result?.canViewGroup&&<label><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/>仅本人接粉</label>}<button disabled={busy} onClick={()=>void load()}>查询</button></div><p>{basis==='intake'?'选择接粉批次，查看这批号码截至目前的后续数量与资金。':'按每次实际发生日期统计；添加和无效原因归接粉日，回复归回复日。'}这里只汇总已填写接粉日期和渠道的号码，未迁入的手填历史保留在原日报。</p>{error&&<p role="alert">{error}</p>}{result&&<div className={styles.scroll}><table className={styles.table}><thead><tr><th>指标</th><th>合计</th>{result.channels.map(c=><th key={c.id}>{c.name}</th>)}</tr></thead><tbody>{numberMetrics.map(([key,label])=><tr key={key}><th>{label}</th><td>{text(key,result.total[key])}</td>{result.channels.map(c=><td key={c.id}>{text(key,c.values[key])}</td>)}</tr>)}<tr><th>净业绩</th>{[result.total,...result.channels.map(c=>c.values)].map((v,i)=><td key={i}>{text('netCents',v.bankInitialDepositCents+v.cryptoInitialDepositCents+v.bankRechargeCents+v.cryptoRechargeCents-v.withdrawalCents)}</td>)}</tr></tbody></table></div>}</section>;
}
