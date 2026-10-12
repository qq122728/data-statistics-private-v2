// Uses only the local demo database; created fixtures are removed afterward.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
const db = new PrismaClient({datasourceUrl:`file:${resolve('prisma/dev.db')}`});
const origin='http://127.0.0.1:3000';
const name=`__country_spend_test_${Date.now()}`;
const phones=['9900001234501','9900001234502','9900001234503'];
const createdRows=[];
async function login(username,password='ResourceDemo@56790') { const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '); }
async function call(path,cookie,init={}) {return fetch(origin+path,{...init,redirect:'manual',headers:{...init.headers,cookie}});}
async function json(path,cookie,input) {return call(path,cookie,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});}
function batch(country,numbers,materialId='',action='commit') {const f=new FormData();for(const [k,v] of Object.entries({country,numbers,materialId,action,channelId:'demo-fb-m',buyer:name,sourceDate:'2026-10-12'}))f.set(k,v);return {method:'POST',body:f};}
try {
 assert.equal(await db.resourceBuyerPhone.count({where:{phone:{in:phones}}}),0,'fixture numbers must be unused');
 const ads=await login('demo_resource_ads'),sms=await login('demo_resource_sms'),admin=await login('demo_admin','AdminDemo@56790');
 const report=async(query='')=>{const r=await call('/api/resource/buyer-phones?month=2026-10'+query,ads);assert.equal(r.status,200,await r.clone().text());return r.json();};
 for(const phone of phones){const r=await db.customerSheetRow.create({data:{phone,groupId:'demo-group',ownerId:'demo-reception',data:JSON.stringify({phone,channelId:'demo-fb-m',quality:'有效',firstDeposit:500,intakeOn:'2026-10-12'})}});createdRows.push(r.id);}
 const matForm=new FormData(); for(const [k,v] of Object.entries({channelId:'demo-fb-m',buyer:name,name}))matForm.set(k,v);
 const m=await call('/api/resource/materials',ads,{method:'POST',body:matForm});assert.equal(m.status,201,await m.clone().text());const materialId=(await m.json()).material.id;
 assert.equal((await call('/api/resource/buyer-phones',ads,batch('',phones[0]))).status,400);
 assert.equal((await call('/api/resource/buyer-phones',ads,batch('DE',phones.slice(0,2).join('\n'),materialId))).status,200);
 assert.equal((await call('/api/resource/buyer-phones',ads,batch('SG',phones[2],materialId))).status,200);
 const conflict=await call('/api/resource/buyer-phones',ads,batch('SG',phones[0],materialId,'preview'));assert.equal((await conflict.json()).counts.conflict,1);
 assert.equal((await call('/api/resource/buyer-phones',ads,batch('SG',phones[0],materialId))).status,409);
 const input={channelId:'demo-fb-m',buyer:name,country:'DE',spendDate:'2026-10-12',materialId,currency:'USD',amount:'100.00'};
 assert.equal((await json('/api/resource/buyer-spend',ads,input)).status,200);
 assert.equal((await json('/api/resource/buyer-spend',ads,{...input,amount:'120.25'})).status,200);
 let data=await report(),rows=data.summary.filter(r=>r.buyer===name);assert.equal(rows.length,2);
 const de=rows.find(r=>r.country==='DE');assert.equal(de.imported,2);assert.equal(de.opened,2);assert.deepEqual(de.spend,[{currency:'USD',amountCents:12025}]);
 assert.equal(data.spends.filter(s=>s.buyer===name).length,1,'second save must update, not insert');
 assert.equal(data.materialSummary.find(r=>r.materialId===materialId&&r.country==='DE').spend[0].amountCents,12025);
 assert.equal((await json('/api/resource/buyer-spend',ads,{...input,country:'SG',amount:'80'})).status,200);
 data=await report('&country=SG');assert.ok(data.details.every(r=>r.country==='SG'));assert.ok(data.summary.every(r=>r.country==='SG'));assert.ok(data.materialSummary.every(r=>r.country==='SG'));assert.ok(data.spends.every(r=>r.country==='SG'));
 const buyer=await db.trafficBuyer.findUnique({where:{channelId_name:{channelId:'demo-fb-m',name}}});
 data=await report('&detailBuyerId='+buyer.id+'&detailCountry=DE');assert.equal(data.detailTotal,2);assert.ok(data.details.every(r=>r.country==='DE'));
 // Old imports can be explicitly assigned a country without duplicating the phone.
 await db.resourceBuyerPhone.update({where:{channelId_phone:{channelId:'demo-fb-m',phone:phones[0]}},data:{country:''}});
 assert.equal((await (await call('/api/resource/buyer-phones',ads,batch('DE',phones[0],materialId,'preview'))).json()).counts.resolve,1);
 assert.equal((await call('/api/resource/buyer-phones',ads,batch('DE',phones[0],materialId))).status,200);
 assert.equal(await db.resourceBuyerPhone.count({where:{buyerId:buyer.id}}),3);
 // Spend-only countries remain visible and currencies never get summed together.
 await json('/api/resource/buyer-spend',ads,{...input,country:'GB',amount:'20'});
 await json('/api/resource/buyer-spend',ads,{...input,currency:'EUR',amount:'10'});
 await json('/api/resource/buyer-spend',ads,{...input,spendDate:'2026-09-12',amount:'999'});
 data=await report();assert.equal(data.summary.find(r=>r.buyer===name&&r.country==='GB').imported,0);assert.equal(data.summary.find(r=>r.buyer===name&&r.country==='DE').spend.length,2);assert.ok(data.spends.every(r=>r.spendDate.startsWith('2026-10')));
 for(const amount of ['-1','1.001','1e3','20000000.01'])assert.equal((await json('/api/resource/buyer-spend',ads,{...input,amount})).status,400);
 assert.equal((await json('/api/resource/buyer-spend',ads,{...input,country:'ZZ'})).status,400);
 assert.equal((await json('/api/resource/buyer-spend',ads,{...input,currency:'INVALID'})).status,400);
 assert.equal((await json('/api/resource/buyer-spend',sms,input)).status,403);
 assert.equal((await json('/api/resource/buyer-spend',admin,input)).status,403);
 assert.ok([401,307].includes((await json('/api/resource/buyer-spend','',input)).status));
 const adminReport=await (await call('/api/resource/buyer-phones?month=2026-10&country=DE',admin)).json();assert.ok(adminReport.summary.some(r=>r.buyer===name));
 console.log('PASS: country import/filter/drilldown, country conflicts, old-country completion, daily spend replacement, currency isolation, spend-only countries, month boundaries, material attribution, role access and invalid input');
} finally {
 const buyers=await db.trafficBuyer.findMany({where:{name}});for(const buyer of buyers){await db.resourceBuyerSpend.deleteMany({where:{buyerId:buyer.id}});await db.resourceBuyerPhone.deleteMany({where:{buyerId:buyer.id}});await db.resourceBuyerMaterial.deleteMany({where:{buyerId:buyer.id}});await db.trafficBuyer.delete({where:{id:buyer.id}});}
 await db.customerSheetRow.deleteMany({where:{id:{in:createdRows}}}); await db.$disconnect();
}
