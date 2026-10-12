// Local seeded demo only. Run with the backend/frontend already running.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { unlink, readdir } from 'node:fs/promises';
const origin = 'http://127.0.0.1:3000';
const db = new PrismaClient({datasourceUrl:`file:${resolve('prisma/dev.db')}`});
const runName = `__material_test_${Date.now()}`;
const created = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRzQAAAAASUVORK5CYII=', 'base64');
async function login(username,password='ResourceDemo@56790') {
 const result = await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
 assert.equal(result.status,200,`login ${username}`); return result.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
}
async function call(path,cookie,init={}) {return fetch(origin+path,{...init,headers:{...init.headers,cookie},redirect:'manual'});}
function form(channelId,name,bytes=png,filename='sample.png') {const data=new FormData(); data.set('channelId',channelId);data.set('buyer','QQ');data.set('name',name);data.set('file',new Blob([bytes]),filename);return data;}
try {
 const ads=await login('demo_resource_ads'), sms=await login('demo_resource_sms'), admin=await login('demo_admin','AdminDemo@56790');
 const list=await (await call('/api/resource/buyer-phones',ads)).json();
 const channel=list.channels.find(c=>c.channelType==='ADS'); assert.ok(channel);
 const result=await call('/api/resource/materials',ads,{method:'POST',body:form(channel.id,runName)});
 assert.equal(result.status,201,await result.clone().text()); const {material}=await result.json();created.push(material.id);
 const path=`/api/resource/materials/${material.id}/file`;
 const importForm=new FormData();importForm.set('action','commit');importForm.set('country','DE');importForm.set('channelId',channel.id);importForm.set('buyer','QQ');importForm.set('materialId',material.id);importForm.set('sourceDate','2026-10-12');importForm.set('numbers','990001122334455');
 assert.equal((await call('/api/resource/buyer-phones',ads,{method:'POST',body:importForm})).status,200);
 const attributed=await db.resourceBuyerPhone.findFirst({where:{materialId:material.id}});assert.equal(attributed?.phone,'990001122334455');
 const report=await (await call('/api/resource/buyer-phones?month=2026-10&detailMaterialId='+material.id,ads)).json();assert.equal(report.detailTotal,1);assert.equal(report.materialSummary.find(m=>m.materialId===material.id).imported,1);

 const download=await call(path+'?download=1',ads); assert.equal(download.status,200); assert.match(download.headers.get('content-disposition'),/^attachment/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
 const range=await call(path,ads,{headers:{Range:'bytes=0-7'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),png.subarray(0,8));
 assert.equal((await call(path,ads,{headers:{Range:'bytes=999999-'}})).status,416);
 assert.equal((await call(path,sms)).status,403);
 assert.equal((await call(path,admin)).status,200);
 assert.equal((await call('/api/resource/materials',admin,{method:'POST',body:form(channel.id,runName+'admin')})).status,403);
 assert.equal((await call('/api/resource/materials',sms,{method:'POST',body:form(channel.id,runName+'sms')})).status,403);
 assert.notEqual((await call(path,'')).status,200);
 const largeVideo=Buffer.alloc(11*1024*1024);largeVideo.writeUInt32BE(24);largeVideo.write('ftypmp42',4,'ascii');
 const largeResponse=await call('/api/resource/materials',ads,{method:'POST',body:form(channel.id,runName+'large',largeVideo,'large.mp4')});
 assert.equal(largeResponse.status,201,await largeResponse.clone().text()); const largeMaterial=(await largeResponse.json()).material;created.push(largeMaterial.id);assert.equal(largeMaterial.fileBytes,largeVideo.length);
 const largeImage=Buffer.alloc(11*1024*1024);png.copy(largeImage);
 assert.equal((await call('/api/resource/materials',ads,{method:'POST',body:form(channel.id,runName+'large-image',largeImage)})).status,413);
 const filesBefore=(await readdir(resolve('storage/resource-materials'))).sort();
 assert.equal((await call('/api/resource/materials',ads,{method:'POST',body:form(channel.id,runName)})).status,409);
 assert.deepEqual((await readdir(resolve('storage/resource-materials'))).sort(),filesBefore,'duplicate failure must clean newly uploaded file');
 assert.equal((await call('/api/resource/materials',ads,{method:'POST',body:form(channel.id,runName+'fake',Buffer.from('<script>fake video</script>'),'fake.mp4')})).status,400);
 const invalid=new FormData();invalid.set('file',new Blob([Buffer.from('bad')]),'bad.mp4');assert.equal((await call(path,ads,{method:'PUT',body:invalid})).status,400);
 assert.deepEqual(Buffer.from(await (await call(path,ads)).arrayBuffer()),png,'failed replacement retains old file');
 const replacement=new FormData();replacement.set('file',new Blob([png]),'new-image.png'); assert.equal((await call(path,ads,{method:'PUT',body:replacement})).status,200);
 const replaced=await db.resourceBuyerMaterial.findUnique({where:{id:material.id}});assert.notEqual(replaced.fileKey,material.fileKey);assert.equal(replaced.fileName,'new-image.png');
 assert.equal((await call('/api/resource/buyer-phones',ads,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({materialId:material.id,active:false})})).status,200);
 assert.equal((await call(path,ads)).status,200,'inactive material still accessible for history');
 console.log('PASS: image upload, download equality, media byte ranges and uploads over 10 MB, ADS/SMS/HQ access, unauthenticated denial, duplicate cleanup, invalid files, file replacement and retained history');
} finally {
 for (const id of created) {const item=await db.resourceBuyerMaterial.findUnique({where:{id}});if(item?.name.startsWith(runName)){await db.resourceBuyerPhone.deleteMany({where:{materialId:id}});await db.resourceBuyerMaterial.delete({where:{id}});if(item.fileKey)await unlink(resolve('storage/resource-materials',item.fileKey));}}
 await db.$disconnect();
}
