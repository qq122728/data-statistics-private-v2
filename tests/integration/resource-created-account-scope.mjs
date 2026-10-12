// Local-only acceptance for accounts created through the resource admin UI.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const db=new PrismaClient({datasourceUrl:`file:${resolve('prisma/dev.db')}`});
const origin='http://127.0.0.1:3000';
const created=[];const evidence=[];
async function login(username,password){const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);const body=await r.json();assert.equal(body.mustChangePassword,false);return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
async function call(path,cookie,body){return fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
async function report(cookie){const r=await call('/api/resource/buyer-phones?month=2026-10',cookie);assert.equal(r.status,200);return r.json();}
try{
 const admin=await login('demo_admin','AdminDemo@56790');
 const accounts=[{type:'ADS',username:'qa_ads_1012'},{type:'SMS',username:'qa_sms_1012'}];
 for(const a of accounts){
  a.cookie=await login(a.username,'QaTest@1012');
  const user=await db.user.findUniqueOrThrow({where:{username:a.username}});assert.equal(user.resourceChannelTypeScope,a.type);
  const expected=await db.channel.findMany({where:{active:true,channelType:a.type,group:{active:true}},select:{id:true}});
  const data=await report(a.cookie);assert.deepEqual([...new Set(data.channels.map(c=>c.id))].sort(),[...new Set(expected.map(c=>c.id))].sort());assert.ok(data.channels.every(c=>c.channelType===a.type));
  evidence.push({account:a.username,check:'全部现有对应类型渠道，无跨部门渠道',channelCount:data.channels.length});
  const denied=await call('/api/org/resource-managers',a.cookie,{username:'should_not_create',name:'禁止越权',password:'123456',resourceChannelTypeScope:a.type});assert.equal(denied.status,403);
 }
 for(const type of ['ADS','SMS']){
  const r=await call('/api/admin/channels',admin,{name:`验收新增${type}_${Date.now()}`,global:true,channelType:type,currentPassword:'AdminDemo@56790',highRiskReason:'本地验收新增渠道自动授权，结束清理'});const body=await r.json();assert.equal(r.status,201,JSON.stringify(body));assert.ok(body.id);created.push(body.id);
  for(const a of accounts){const data=await report(a.cookie);assert.equal(data.channels.some(c=>c.id===body.id),a.type===type);if(a.type!==type){const denied=await call('/api/resource/buyer-phones?month=2026-10&channelId='+body.id,a.cookie);assert.equal(denied.status,403);}}
  evidence.push({check:'不重新登录即可看到新增同类型渠道，另一部门查询被拒绝',type});
 }
 const all=await report(admin);assert.ok(all.channels.some(c=>c.channelType==='ADS'));assert.ok(all.channels.some(c=>c.channelType==='SMS'));
 evidence.push({check:'总公司管理员查看两类全部渠道，资源负责人不能创建账号',passed:true});
 await writeFile('outputs/resource-created-account-scope-results.json',JSON.stringify(evidence,null,2));
 console.log('PASS: UI-created accounts direct login, complete existing type scope, automatic future channels in existing sessions, cross-type denial, admin combined view, resource account-creation denial');
}finally{
 if(created.length){await db.resourceChannelAccess.deleteMany({where:{channelId:{in:created}}});await db.channel.deleteMany({where:{id:{in:created}}});}
 await db.$disconnect();
}
