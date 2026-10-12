// End-to-end business API -> resource report, only against local seeded demo.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const db=new PrismaClient({datasourceUrl:`file:${resolve('prisma/dev.db')}`});
const origin='http://127.0.0.1:3000';
const name=`__business_link_${Date.now()}`;
const created=[];const evidence=[];let reception;
async function login(username,password){const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
async function call(path,cookie,body,method='POST'){const r=await fetch(origin+path,{method,headers:{cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,200,JSON.stringify({path,data}));return data;}
async function resource(cookie){return call('/api/resource/buyer-phones?month=2026-10',cookie,null,'GET');}
async function check(a,stage,expected){const data=await resource(a.cookie);const row=data.summary.find(r=>r.buyer===name);for(const[k,v]of Object.entries(expected))assert.equal(row[k],v,`${a.type} ${stage} ${k}`);if(a.materialId){const material=data.materialSummary.find(r=>r.materialId===a.materialId);for(const[k,v]of Object.entries(expected))assert.equal(material[k],v,`${a.type} material ${stage} ${k}`);}evidence.push({department:a.type,stage,expected,materialVerified:!!a.materialId});return data;}
try{
 reception=await login('demo_reception','ReceptionDemo@56790');const expert=await login('demo_expert','ExpertDemo@56790');
 const accounts=[{type:'ADS',user:process.env.RESOURCE_TEST_ADS_USER||'demo_resource_ads',channel:'demo-fb-m',country:'DE',phones:['9900003234501','9900003234502']},{type:'SMS',user:process.env.RESOURCE_TEST_SMS_USER||'demo_resource_sms',channel:'demo-channel-sms',country:'SG',phones:['9900003234503','9900003234504']}];
 for(const a of accounts){
  assert.equal(await db.customerSheetRow.count({where:{phone:{in:a.phones}}}),0);assert.equal(await db.resourceBuyerPhone.count({where:{phone:{in:a.phones}}}),0);
  a.cookie=await login(a.user,process.env.RESOURCE_TEST_PASSWORD||'ResourceDemo@56790');
  if(a.type==='ADS'){const mf=new FormData();for(const[k,v]of Object.entries({channelId:a.channel,buyer:name,name:name+'素材',url:'https://example.com/local-test'}))mf.set(k,v);const mr=await fetch(origin+'/api/resource/materials',{method:'POST',headers:{cookie:a.cookie},body:mf});assert.equal(mr.status,201);a.materialId=(await mr.json()).material.id;}
  const form=new FormData();for(const[k,v]of Object.entries({action:'commit',channelId:a.channel,buyer:name,country:a.country,sourceDate:'2026-10-01',numbers:a.phones.join('\n'),materialId:a.materialId||''}))form.set(k,v);
  const imp=await fetch(origin+'/api/resource/buyer-phones',{method:'POST',headers:{cookie:a.cookie},body:form});assert.equal(imp.status,200);
  await check(a,'资源先导入，业务尚无记录',{imported:2,matched:0,pending:2,opened:0});
  const result=await call('/api/customer-sheet/rows',reception,{groupId:'demo-group',rows:[{phone:a.phones[0],channelId:a.channel,intakeOn:'2026-10-01',quality:'有效'}]});
  const id=result.ids[0];created.push(id);let version=1;
  await check(a,'接粉录入后自动匹配',{matched:1,pending:1,valid:1,replied:0,joined:0,opened:0});
  const patch=async(cookie,values)=>{const response=await call('/api/customer-sheet/rows/'+id,cookie,{version,values},'PATCH');version=response.version;return response;};
  await patch(reception,{replied:true,repliedOn:'2026-10-02',joinedOn:'2026-10-03',operatorId:'demo-operator',expertId:'demo-expert',addedExpert:true,expertOn:'2026-10-05'});
  await check(a,'业务回复、进群、推专家后资源更新',{replied:1,joined:1,expert:1,registered:0,opened:0});
  await patch(expert,{registeredOn:'2026-10-06',firstDeposit:500,firstDepositOn:'2026-10-07'});
  await check(a,'专家注册和首充500',{registered:1,opened:1,firstCents:50000,netCents:50000});
  for(const[kind,amount,date]of [['recharge',250,'2026-10-08'],['withdrawal',50,'2026-10-09']]){
   const response=await call('/api/customer-sheet/rows/'+id+'/recharges',expert,{version,requestId:randomUUID(),kind,amount,date,method:'bank'});version=response.version;
  }
  let data=await check(a,'续充250、出金50，净业绩700',{rechargeCents:25000,withdrawalCents:5000,netCents:70000});
  const detail=data.details.find(r=>r.phone===a.phones[0]);assert.equal(detail.metrics.intakeOn,'2026-10-01');assert.equal(detail.metrics.openedOn,'2026-10-07');assert.equal(detail.channelId,a.channel);assert.equal(detail.country,a.country);
  await patch(expert,{firstDeposit:600});await check(a,'更正首充600后自动重算净业绩800',{firstCents:60000,rechargeCents:25000,withdrawalCents:5000,netCents:80000});
  const wrong=await call('/api/customer-sheet/rows',reception,{groupId:'demo-group',rows:[{phone:a.phones[1],channelId:a.type==='ADS'?'demo-channel-sms':'demo-fb-m',intakeOn:'2026-10-01',quality:'有效'}]});const second=wrong.ids[0];created.push(second);
  await check(a,'号码相同但渠道不同，不错误匹配',{matched:1,pending:1,valid:1});
  const invalid=await fetch(origin+'/api/customer-sheet/rows/'+second,{method:'PATCH',headers:{cookie:reception,'content-type':'application/json'},body:JSON.stringify({version:1,values:{quality:'低金额'}})});assert.equal(invalid.status,400);
  evidence.push({department:a.type,stage:'业务端拒绝录入低金额无效粉',status:400});
  await call('/api/customer-sheet/rows/'+second,reception,{version:1,values:{channelId:a.channel}},'PATCH');
  await check(a,'渠道更正后自动匹配',{matched:2,pending:0,valid:2,opened:1});
  await call('/api/resource/buyer-spend',a.cookie,{channelId:a.channel,buyer:name,country:a.country,spendDate:'2026-10-01',currency:'USD',amount:'100',materialId:''});
  data=await resource(a.cookie);const costs=data.summary.find(r=>r.buyer===name);assert.equal(costs.spend[0].amountCents/costs.imported,5000);assert.equal(costs.spend[0].amountCents/costs.valid,5000);assert.equal(costs.spend[0].amountCents/costs.opened,10000);
  evidence.push({department:a.type,stage:'关联消耗100',singleFanCost:50,effectiveCost:50,orderCost:100});
  const deleted=await call('/api/customer-sheet/rows/'+id+'/deletion',reception,{version,deleted:true});version=deleted.version;
  await check(a,'业务删除后不再计算成交及资金',{matched:1,pending:1,valid:1,opened:0,firstCents:0,rechargeCents:0,withdrawalCents:0,netCents:0});
  await call('/api/customer-sheet/rows/'+id+'/deletion',reception,{version,deleted:false});
  await check(a,'业务恢复后数据自动恢复',{matched:2,pending:0,valid:2,opened:1,firstCents:60000,rechargeCents:25000,withdrawalCents:5000,netCents:80000});
 }
 await writeFile('outputs/resource-business-link-results.json',JSON.stringify(evidence,null,2));
 console.log('PASS: both departments, real reception/expert APIs, pending-to-matched, reply/join/expert/register/order, recharge/withdrawal, correction, channel isolation, invalid quality, unit costs, deletion/restoration and dates');
}finally{
 for(const id of created){const row=await db.customerSheetRow.findUnique({where:{id}});if(row)await call('/api/customer-sheet/rows/'+id+'/deletion',reception,{version:row.version,action:'permanent'});}
 for(const b of await db.trafficBuyer.findMany({where:{name}})){await db.resourceBuyerSpend.deleteMany({where:{buyerId:b.id}});await db.resourceBuyerPhone.deleteMany({where:{buyerId:b.id}});await db.resourceBuyerMaterial.deleteMany({where:{buyerId:b.id}});await db.trafficBuyer.delete({where:{id:b.id}});}
 await db.$disconnect();
}
