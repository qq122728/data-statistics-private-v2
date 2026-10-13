import { numberEvents } from './number-statistics';
import type { SheetData } from './schema';

export type InsightRow = { data: SheetData; owner?: string; channel?: string };
export const day = (v: unknown) => { const s = String(v || '').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s ? s : ''; };
export const shiftDay = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0,10);
export const money = (c: number) => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const percent = (n: number, d: number) => d ? (100*n/d).toFixed(1)+'%' : '—';
const empty = () => ({ orders: 0, firstCents: 0, rechargeCents: 0, renewed: 0 });
export function finance(rows: InsightRow[], from: string, to: string) {
  const total = empty();
  const intake = { current: empty(), old: empty(), other: empty() };
  const opening = { current: 0, previous: 0, earlier: 0, other: 0 };
  const month = to.slice(0,7), prev = shiftDay(month+'-01',-1).slice(0,7);
  for (const { data } of rows) {
    const events = numberEvents(data).filter(e => day(e.date));
    const opened = events.find(e => e.field === 'orderCount')?.date || '';
    const received = day(data.intakeOn);
    const bucket = received && received <= opened ? (received.slice(0,7) === month ? 'current' : received.slice(0,7) < month ? 'old' : 'other') : 'other';
    let renewed = false;
    for (const e of events.filter(e => e.date >= from && e.date <= to)) {
      if (e.field === 'orderCount') { total.orders += e.value; intake[bucket].orders += e.value; }
      if (['bankInitialDepositCents','cryptoInitialDepositCents'].includes(e.field)) { total.firstCents += e.value; intake[bucket].firstCents += e.value; }
      if (['bankRechargeCents','cryptoRechargeCents'].includes(e.field)) {
        total.rechargeCents += e.value; if (e.value > 0) renewed = true;
        const key = !opened || opened > e.date ? 'other' : opened.slice(0,7) === month ? 'current' : opened.slice(0,7) === prev ? 'previous' : opened.slice(0,7) < prev ? 'earlier' : 'other';
        opening[key] += e.value;
      }
    }
    if (renewed) total.renewed++;
  }
  return { ...total, averageFirst: total.orders ? total.firstCents/total.orders : null, averageRecharge: total.renewed ? total.rechargeCents/total.renewed : null, intake, opening };
}
export const abilitySpecs = [
  { key:'reply', label:'7天回复率', anchor:'intakeOn', event:'replyCount', age:7, minimum:30 },
  { key:'join', label:'7天进群率', anchor:'intakeOn', event:'joinCount', age:7, minimum:30 },
  { key:'intro', label:'进群7天介绍率', anchor:'joinedOn', event:'expertIntroCount', age:7, minimum:30 },
  { key:'timely', label:'进群3天按时介绍率', anchor:'joinedOn', event:'expertIntroCount', age:3, minimum:30 },
  { key:'exit', label:'7天异常退群率', anchor:'joinedOn', event:'abnormalLeaveCount', age:7, minimum:30 },
  { key:'register', label:'接手7天注册率', anchor:'expertOn', event:'registrationCount', age:7, minimum:30 },
  { key:'expertOrder', label:'接手30天开单率', anchor:'expertOn', event:'orderCount', age:30, minimum:30 },
  { key:'leadOrder', label:'接粉30天开单率', anchor:'intakeOn', event:'orderCount', age:30, minimum:30 },
  { key:'renew', label:'开单30天续充率', anchor:'firstDepositOn', event:'recharge', age:30, minimum:10 },
  { key:'renewAmount', label:'开单30天人均续充', anchor:'firstDepositOn', event:'recharge', age:30, minimum:10 },
] as const;
export function abilities(rows: InsightRow[], cutoff: string) {
  return abilitySpecs.map(spec => {
    const end = shiftDay(cutoff,1-spec.age), start = shiftDay(end,-13);
    const measure = (from: string,to: string) => {
      let n=0,hits=0,cents=0;
      for (const {data} of rows) {
        const anchor=day(data[spec.anchor]);
        if (!anchor || anchor<from || anchor>to) continue;
        const events=numberEvents(data).filter(e=>day(e.date));
        if (!events.length || (spec.anchor==='firstDepositOn' && !events.some(e=>e.field==='orderCount'))) continue;
        if(spec.anchor==='expertOn' && !events.some(e=>e.field==='expertIntroCount')) continue;
        const intake=day(data.intakeOn); if(intake && anchor<intake) continue;
        n++;
        const selected=events.filter(e=>e.date>=anchor && e.date<=shiftDay(anchor,spec.age-1) && (spec.event==='recharge' ? ['bankRechargeCents','cryptoRechargeCents'].includes(e.field) : e.field===spec.event));
        if(selected.some(e=>e.value>0)) hits++;
        cents+=selected.reduce((s,e)=>s+e.value,0);
      }
      return { from,to,n,hits,cents,value:n?(spec.key==='renewAmount'?cents/n:hits/n):null };
    };
    const current=measure(start,end),previous=measure(shiftDay(start,-14),shiftDay(end,-14));
    const comparable=current.n>=spec.minimum&&previous.n>=spec.minimum&&previous.value!==null&&previous.value>0;
    const decline=comparable?(previous.value!-current.value!)/previous.value!:null;
    return { ...spec,current,previous,comparable,decline,alert:decline!==null && (spec.key==='exit'?-decline:decline)>=0.1-1e-10 };
  });
}
export function botInsights(input: InsightRow[], date: string, completedThrough=date) {
  const rows=input.filter(r=>!r.data.__deletedAt && r.data.intakeOn && r.data.channelId);
  const month=date.slice(0,7)+'-01';
  const people=[...new Set(rows.map(r=>r.owner||'未分配'))].map(owner=>{
    const own=rows.filter(r=>(r.owner||'未分配')===owner),cohort=own.filter(r=>day(r.data.intakeOn)>=month&&day(r.data.intakeOn)<=date);
    const count=(field:string)=>cohort.filter(r=>numberEvents(r.data).some(e=>e.field===field && e.date>=day(r.data.intakeOn)&&e.date<=date)).length;
    const f=finance(own,month,date);
    return {owner,leads:cohort.length,replies:count('replyCount'),joins:count('joinCount'),introductions:count('expertIntroCount'),...f};
  }).filter(p=>p.leads||p.orders).sort((a,b)=>b.leads-a.leads);
  const channels=[...new Set(rows.map(r=>r.channel||String(r.data.channelId)))].map(channel=>({channel,metrics:abilities(rows.filter(r=>(r.channel||String(r.data.channelId))===channel),completedThrough)}));
  const assignees=(field:'operatorId'|'expertId')=>[...new Set(rows.map(r=>String(r.data[field]||'未分配')))].map(id=>({id,metrics:abilities(rows.filter(r=>String(r.data[field]||'未分配')===id),completedThrough)}));
  const previousMonthEnd=shiftDay(month,-1), endDay=Math.min(Number(date.slice(-2)),Number(previousMonthEnd.slice(-2)));
  const comparisonEnd=date.slice(0,7)+'-'+String(endDay).padStart(2,'0'), previousEnd=previousMonthEnd.slice(0,7)+'-'+String(endDay).padStart(2,'0');
  return {date,month,day:finance(rows,date,date),monthFinance:finance(rows,month,date),people,channels,operators:assignees('operatorId'),experts:assignees('expertId'),
    firstComparison:{current:finance(rows,month,comparisonEnd),previous:finance(rows,previousEnd.slice(0,7)+'-01',previousEnd),from:month,to:comparisonEnd,previousFrom:previousEnd.slice(0,7)+'-01',previousTo:previousEnd}};
}
export type BotInsights = ReturnType<typeof botInsights>;
