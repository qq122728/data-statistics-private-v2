// Local demo workflow regression. Only uniquely named fixtures are removed.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { resolve } from 'node:path';
const db = new PrismaClient({ datasourceUrl: `file:${resolve('prisma/dev.db')}` });
const origin = 'http://127.0.0.1:3000';
const name = `__two_accounts_${Date.now()}`;
const fixtureRows = [];
async function login(username) {
 const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'ResourceDemo@56790'})});
 assert.equal(r.status,200);return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
}
async function call(path,cookie,init={}) {return fetch(origin+path,{...init,redirect:'manual',headers:{...init.headers,cookie}});}
async function report(cookie,query='') {const r=await call('/api/resource/buyer-phones?month=2026-10'+query,cookie);assert.equal(r.status,200);return r.json();}
try {
 const accounts=[{user:'demo_resource_ads',type:'ADS',channel:'demo-fb-m',country:'DE',phones:['9900002234501','9900002234502']},{user:'demo_resource_sms',type:'SMS',channel:'demo-channel-sms',country:'SG',phones:['9900002234503','9900002234504']}];
 for(const a of accounts)a.cookie=await login(a.user);
 for(const a of accounts){
  assert.equal(await db.customerSheetRow.count({where:{phone:{in:a.phones}}}),0);
  assert.equal(await db.resourceBuyerPhone.count({where:{phone:{in:a.phones}}}),0);
  const own=await report(a.cookie);assert.ok(own.channels.length);assert.ok(own.channels.every(c=>c.channelType===a.type));
  const row=await db.customerSheetRow.create({data:{phone:a.phones[0],groupId:'demo-group',ownerId:'demo-reception',data:JSON.stringify({phone:a.phones[0],channelId:a.channel,quality:'有效',firstDeposit:500,intakeOn:'2026-10-12'})}});fixtureRows.push(row.id);
  const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('号码');sheet.addRows([['ID','代号'],['+'+a.phones[0],name],[a.phones[1],name],[a.phones[1],name]]);const bytes=await workbook.xlsx.writeBuffer();
  const form=action=>{const f=new FormData();for(const[k,v]of Object.entries({action,channelId:a.channel,buyer:name,country:a.country,sourceDate:'2026-10-12'}))f.set(k,v);f.set('file',new Blob([bytes]),'test.xlsx');return {method:'POST',body:f};};
  const preview=await call('/api/resource/buyer-phones',a.cookie,form('preview'));assert.equal(preview.status,200);const p=await preview.json();assert.equal(p.total,2);assert.equal(p.skippedHeaders,1);assert.equal(p.duplicateCount,1);assert.equal(p.counts.matched,1);assert.equal(p.counts.pending,1);
  assert.equal((await call('/api/resource/buyer-phones',a.cookie,form('commit'))).status,200);
  const duplicate=await call('/api/resource/buyer-phones',a.cookie,form('preview'));assert.equal((await duplicate.json()).counts.already,2);
  const spend={channelId:a.channel,buyer:name,country:a.country,spendDate:'2026-10-12',currency:'USD',amount:'80',materialId:''};
  assert.equal((await call('/api/resource/buyer-spend',a.cookie,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(spend)})).status,200);
  const data=await report(a.cookie);const result=data.summary.find(r=>r.buyer===name);assert.equal(result.imported,2);assert.equal(result.matched,1);assert.equal(result.pending,1);assert.equal(result.valid,1);assert.equal(result.opened,1);assert.equal(result.firstCents,50000);assert.equal(result.spend[0].amountCents,8000);assert.equal(result.spend[0].amountCents/result.imported,4000);
  const other=accounts.find(b=>b!==a);
  assert.equal((await call('/api/resource/buyer-phones?month=2026-10&channelId='+a.channel,other.cookie)).status,403);
  assert.equal((await call('/api/resource/buyer-phones',other.cookie,form('commit'))).status,403);
  assert.equal((await call('/api/resource/buyer-spend',other.cookie,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(spend)})).status,403);
  if(a.type==='SMS'){
   const f=new FormData();for(const[k,v]of Object.entries({channelId:a.channel,buyer:name,name:'不允许的短信素材',url:'https://example.com/sample'}))f.set(k,v);
   assert.equal((await call('/api/resource/materials',a.cookie,{method:'POST',body:f})).status,403);
   assert.equal(data.materials.length,0);
  }
 }
 console.log('PASS: ADS and SMS login, type scope, Excel header/duplicate preview, import, pending/matched effects, first deposits, spend and unit cost, cross-department read/write denial, SMS material denial');
} finally {
 for(const b of await db.trafficBuyer.findMany({where:{name}})) {await db.resourceBuyerSpend.deleteMany({where:{buyerId:b.id}});await db.resourceBuyerPhone.deleteMany({where:{buyerId:b.id}});await db.resourceBuyerMaterial.deleteMany({where:{buyerId:b.id}});await db.trafficBuyer.delete({where:{id:b.id}});}
 await db.customerSheetRow.deleteMany({where:{id:{in:fixtureRows}}});await db.$disconnect();
}
