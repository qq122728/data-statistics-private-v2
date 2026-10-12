// Explicit opt-in: never point this test at a live database.
import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const state=vi.hoisted(()=>({session:'',url:process.env.RESOURCE_REHEARSAL_DATABASE_URL||''}));
vi.mock('../../src/lib/db',async()=>{
 const u=new URL(state.url);
 if(u.hostname!=='127.0.0.1'||u.port!=='55434'||u.pathname!=='/resource_rehearsal')throw new Error('Requires isolated local resource_rehearsal database on port 55434');
 const {PrismaClient}=await import('../../node_modules/.prisma/postgres-migration-client/index.js');
 return {db:new PrismaClient({datasourceUrl:state.url})};
});
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:state.session})})}));
import { db } from '../../src/lib/db';
import { authenticateUser,createSession,hashPassword } from '../../src/lib/auth';
import { POST as createAccount } from '../../src/app/api/org/resource-managers/route';
import { POST as importPhones,GET as report } from '../../src/app/api/resource/buyer-phones/route';
import { POST as spend } from '../../src/app/api/resource/buyer-spend/route';
import { managementCustomerProgress } from '../../src/lib/management-customer-progress';
const prefix='__resource_rehearsal_'+randomUUID();
const users:string[]=[];const sessions:string[]=[];const buyers:string[]=[];
const evidence:any={environment:'isolated production snapshot',attribution:'Simulated buyer/country assignment for matching tests only; not verified real buyer ownership.',samples:[],checks:[]};
async function signIn(id:string){const s=await createSession(id);sessions.push(s.id);state.session=s.id;}
const request=(body:unknown)=>new Request('http://127.0.0.1/local-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
async function load(){const r=await report(new Request('http://127.0.0.1/api/resource/buyer-phones?month=2026-10&detailPage=1'));expect(r.status).toBe(200);return r.json();}
async function imp(action:string,fields:Record<string,string>){const form=new FormData();for(const [k,v]of Object.entries({action,...fields}))form.set(k,v);return importPhones(new Request('http://127.0.0.1/local-test',{method:'POST',body:form}));}
it('preserves old permissions and reconciles real customer samples through new resource routes',async()=>{
 const old=await db.user.findMany({where:{active:true,role:'RESOURCE_MANAGER'},include:{resourceChannelAccess:true}});
 for(const u of old){await signIn(u.id);const result=await load();const expected=await db.channel.findMany({where:{id:{in:u.resourceChannelAccess.map(a=>a.channelId)},active:true,group:{active:true},channelType:{in:['ADS','SMS']}}});expect(result.channels.map((c:any)=>c.id).sort()).toEqual([...new Set(expected.map(c=>c.id))].sort());}
 evidence.checks.push({oldResourceAccounts:old.length,permissionChange:false});
 const admin=await db.user.create({data:{id:prefix,username:prefix,name:'隔离预演管理员',role:'ADMIN',passwordHash:hashPassword('LocalRehearsalOnly123')}});users.push(admin.id);await signIn(admin.id);
 const actors:any[]=[];
 for(const type of ['ADS','SMS']){const username=prefix+type;const r=await createAccount(request({username,name:'隔离预演'+type,password:'LocalRehearsalOnly123',resourceChannelTypeScope:type}));expect(r.status).toBe(201);const a=await r.json();users.push(a.id);expect(a.mustChangePassword).toBe(false);expect((await authenticateUser(username,'LocalRehearsalOnly123'))?.id).toBe(a.id);actors.push({...a,type});}
 const channels=await db.channel.findMany({where:{active:true,group:{active:true},channelType:{in:['ADS','SMS']}},include:{group:true}});
 const copies=new Map(channels.map(c=>[c.id+'|'+c.groupId,c]));
 const raw=await db.customerSheetRow.findMany({where:{groupId:{in:[...new Set(channels.map(c=>c.groupId))]}},select:{id:true,groupId:true,phone:true,data:true}});
 const live=raw.map(r=>({...r,d:JSON.parse(r.data)})).filter(r=>!r.d.__deletedAt&&copies.has(r.d.channelId+'|'+r.groupId));
 for(const actor of actors){
  await signIn(actor.id);const visible=await load();expect(visible.channels.every((c:any)=>c.channelType===actor.type)).toBe(true);expect(visible.channels.length).toBe(new Set(channels.filter(c=>c.channelType===actor.type).map(c=>c.id)).size);
  let selected:any[]=[];
  for(const channel of visible.channels){const rows=live.filter(r=>r.d.channelId===channel.id);selected.push(...rows.filter(r=>Number(r.d.firstDeposit)>0).slice(0,5),...rows.filter(r=>!(Number(r.d.firstDeposit)>0)).slice(0,3));}
  // One attribution per channel+phone; group selection resolves cross-group duplicates.
  selected=[...new Map(selected.map(r=>[r.d.channelId+'|'+r.phone,r])).values()];
  const aggregates=new Map<string,any>();
  for(const row of selected){
   const c=copies.get(row.d.channelId+'|'+row.groupId)!;const buyer=prefix+'_'+c.id;buyers.push(buyer);
   const country=['DE','SG','US','GB'].includes(c.group.countryCode||'')?c.group.countryCode!:actor.type==='ADS'?'DE':'SG';
   const fields={channelId:c.id,buyer,country,sourceDate:'2026-10-01',groupId:row.groupId,numbers:row.phone};
   const p=await imp('preview',fields);expect(p.status).toBe(200);expect((await p.json()).counts.matched).toBe(1);
   const saved=await imp('commit',fields);expect(saved.status).toBe(200);
   const moneyEntries=row.d.__recharges?JSON.parse(row.d.__recharges):[];
   const first=Math.round(Number(row.d.firstDeposit||0)*100);
   const recharge=moneyEntries.filter((e:any)=>e.kind!=='withdrawal').reduce((s:number,e:any)=>s+e.amountCents,0);
   const withdrawal=moneyEntries.filter((e:any)=>e.kind==='withdrawal').reduce((s:number,e:any)=>s+e.amountCents,0);
   const legacy=row.d.__investmentBaseCents!=null?Number(row.d.__investmentBaseCents):Math.max(0,Math.round(Number(row.d.investmentTotal||0)*100)-first-recharge);
   const key=c.id+'|'+country;const agg=aggregates.get(key)||{channelId:c.id,country,buyer,count:0,opened:0,first:0,recharge:0,withdrawal:0,legacy:0};agg.count++;agg.opened+=first>0?1:0;agg.first+=first;agg.recharge+=recharge;agg.withdrawal+=withdrawal;agg.legacy+=legacy;aggregates.set(key,agg);
   const result=await report(new Request('http://127.0.0.1/api/resource/buyer-phones?month=2026-10&channelId='+c.id));expect(result.status).toBe(200);const body=await result.json();const detail=body.details.find((d:any)=>d.phone===row.phone);expect(detail.status).toBe('matched');expect(detail.metrics.firstCents).toBe(first);expect(detail.metrics.rechargeCents).toBe(recharge);expect(detail.metrics.withdrawalCents).toBe(withdrawal);expect(detail.metrics.netCents).toBe(first+recharge+legacy-withdrawal);expect(detail.metrics.intakeOn).toBe(String(row.d.intakeOn||''));expect(detail.metrics.openedOn).toBe(String(row.d.firstDepositOn||row.d.orderedOn||''));
   const oldPage:any=await managementCustomerProgress(actor.id,new URLSearchParams({groupId:row.groupId,channelId:c.id,q:row.phone}));expect(oldPage.rows).toHaveLength(1);expect(oldPage.rows[0].firstDepositCents).toBe(first);expect(oldPage.rows[0].rechargeCents).toBe(recharge);expect(oldPage.rows[0].withdrawalCents).toBe(withdrawal);
  }
  for(const agg of aggregates.values()){
   for(let i=0;i<2;i++){const r=await spend(request({channelId:agg.channelId,buyer:agg.buyer,country:agg.country,spendDate:'2026-10-01',currency:'USD',amount:'100',note:'隔离副本模拟消耗，非真实投放'}));expect(r.status).toBe(200);}
   const result=await load();const sum=result.summary.find((r:any)=>r.channelId===agg.channelId&&r.country===agg.country);expect(sum.imported).toBe(agg.count);expect(sum.matched).toBe(agg.count);expect(sum.opened).toBe(agg.opened);expect(sum.firstCents).toBe(agg.first);expect(sum.rechargeCents).toBe(agg.recharge);expect(sum.withdrawalCents).toBe(agg.withdrawal);expect(sum.netCents).toBe(agg.first+agg.recharge+agg.legacy-agg.withdrawal);expect(sum.spend).toEqual([{currency:'USD',amountCents:10000}]);
   evidence.samples.push({type:actor.type,channel:channels.find(c=>c.id===agg.channelId)?.name,country:agg.country,customers:agg.count,opened:agg.opened,firstCents:agg.first,rechargeCents:agg.recharge,withdrawalCents:agg.withdrawal,legacyCents:agg.legacy,simulatedSpendCents:10000});
  }
  const other=channels.find(c=>c.channelType!==actor.type)!;expect((await report(new Request('http://127.0.0.1/api/resource/buyer-phones?month=2026-10&channelId='+other.id))).status).toBe(403);
  const pairs=new Map<string,typeof live>();for(const r of live.filter(r=>copies.get(r.d.channelId+'|'+r.groupId)?.channelType===actor.type)){const k=r.d.channelId+'|'+r.phone;pairs.set(k,[...(pairs.get(k)||[]),r]);}
  const dup=[...pairs.values()].find(r=>r.length>1);if(dup){const p=await imp('preview',{channelId:dup[0].d.channelId,buyer:prefix+'_conflict',country:actor.type==='ADS'?'DE':'SG',sourceDate:'2026-10-01',numbers:dup[0].phone});expect(p.status).toBe(200);const data=await p.json();expect(data.counts.ambiguous+data.counts.conflict).toBe(1);evidence.checks.push({type:actor.type,crossGroupDuplicateDetected:true});}
 }
 await signIn(admin.id);const all=await load();expect(all.channels.some((c:any)=>c.channelType==='ADS')).toBe(true);expect(all.channels.some((c:any)=>c.channelType==='SMS')).toBe(true);
 evidence.checks.push({twoTypeWideAccounts:true,directPasswordLogin:true,crossTypeAccessDenied:true,originalProgressAmountsReconciled:true,repeatSpendNotAccumulated:true});
 await writeFile('outputs/resource-production-rehearsal-results.json',JSON.stringify(evidence,null,2));
 console.log('Production-copy reconciliation:',evidence.samples.reduce((s:number,r:any)=>s+r.customers,0),'customers,',evidence.samples.length,'channel-country groups');
});
afterAll(async()=>{
 for(const b of await db.trafficBuyer.findMany({where:{name:{startsWith:prefix}}})){await db.resourceBuyerSpend.deleteMany({where:{buyerId:b.id}});await db.resourceBuyerPhone.deleteMany({where:{buyerId:b.id}});await db.trafficBuyer.delete({where:{id:b.id}});}
 await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.session.deleteMany({where:{id:{in:sessions}}});await db.resourceChannelAccess.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
});
