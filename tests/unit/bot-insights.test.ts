import { describe,it,expect } from 'vitest';
import { botInsights,finance,abilities,type InsightRow } from '../../packages/customer-sheet/bot-insights';
import { compactGroupText,countryAnalysisText,reportHtml } from '../../integrations/data-reports/compact-bot-report';
const row=(data:InsightRow['data']):InsightRow=>({owner:'A',channel:'FB',data:{intakeOn:'2026-09-01',channelId:'fb',...data}});
describe('compact bot report accounting',()=>{
 it('separates intake month from opening month and counts renewing people once',()=>{
  const rows=[row({firstDepositOn:'2026-10-02',firstDeposit:100,__recharges:JSON.stringify([{date:'2026-10-03',amountCents:2000},{date:'2026-10-04',amountCents:3000},{date:'2026-10-05',kind:'withdrawal',amountCents:500}])}),row({intakeOn:'2026-10-01',firstDepositOn:'2026-10-04',firstDeposit:200})];
  const f=finance(rows,'2026-10-01','2026-10-12');expect(f.orders).toBe(2);expect(f.averageFirst).toBe(15000);expect(f.intake.old.orders).toBe(1);expect(f.intake.current.orders).toBe(1);expect(f.renewed).toBe(1);expect(f.rechargeCents).toBe(5000);expect(f.opening.current).toBe(5000);
 });
 it('excludes future events and immature cohorts; includes zero-renewal customers in per-opened average',()=>{
  const rows=Array.from({length:10},(_,i)=>row({firstDepositOn:'2026-09-01',firstDeposit:100,__recharges:JSON.stringify(i===0?[{date:'2026-09-20',amountCents:10000},{date:'2026-10-20',amountCents:999999}]:[])}));
  const m=abilities(rows,'2026-10-01').find(m=>m.key==='renewAmount')!;expect(m.current.n).toBe(10);expect(m.current.value).toBe(1000);
  expect(abilities(rows,'2026-09-15').find(m=>m.key==='renew')!.current.n).toBe(0);
 });
 it('ignores deleted rows and respects actual order event instead of treating recharge as a new order',()=>{
  const f=finance([row({__deletedAt:'x',firstDepositOn:'2026-10-01',firstDeposit:500}),row({firstDepositOn:'2026-09-01',firstDeposit:100,__recharges:JSON.stringify([{date:'2026-10-01',amountCents:5000}])})],'2026-10-01','2026-10-12');
  expect(f.orders).toBe(0);expect(f.opening.previous).toBe(5000);
 });
 it('alerts exactly at a 10% relative decline with sufficient samples; low samples stay quiet',()=>{
  const rows=[...Array.from({length:100},(_,i)=>row({intakeOn:'2026-09-15',replied:i<50,repliedOn:'2026-09-16'})),...Array.from({length:100},(_,i)=>row({intakeOn:'2026-10-01',replied:i<45,repliedOn:'2026-10-02'}))];
  const m=abilities(rows,'2026-10-12')[0];expect(m.current.n).toBe(100);expect(m.previous.n).toBe(100);expect(m.alert).toBe(true);
  expect(abilities(rows.slice(0,5),'2026-10-12')[0].alert).toBe(false);
 });
 it('retains original intake owner and provides escaped rich and plain compact layouts',()=>{
  const a=botInsights([row({replied:true,repliedOn:'2026-10-02',intakeOn:'2026-10-01',firstDeposit:100,firstDepositOn:'2026-10-02'})],'2026-10-12');
  const r={groupId:'g',groupName:'<A>',date:'2026-10-12',countryCode:'SG',daily:{},monthly:{},reception:[],operators:[],experts:[],insights:a,insightNames:{A:'小明'}};
  expect(compactGroupText(r)).toContain('小明｜1｜100.0%');expect(reportHtml(compactGroupText(r))).toContain('&lt;A&gt;');expect(countryAnalysisText([r])).toContain('只有一个小组');expect(countryAnalysisText([r])).not.toContain('NaN');
 });
});
