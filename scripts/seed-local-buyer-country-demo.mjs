// Adds country and spend examples to the existing, explicitly named local demo only.
import {PrismaClient} from '@prisma/client';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const expected=`file:${resolve('prisma/dev.db')}`;
if(process.env.DATABASE_URL && ![expected,'file:./dev.db'].includes(process.env.DATABASE_URL))throw new Error('只允许本地演示数据库');
const db=new PrismaClient({datasourceUrl:expected});
try {
 const fixtures=[['9000000101','DE'],['9000000102','DE'],['9000000103','SG'],['9000000201','SG'],['9000000202','SG'],['9000000301','DE'],['9000000401','SG']];
 for(const [phone,country] of fixtures){const row=await db.resourceBuyerPhone.findFirst({where:{phone,groupId:'demo-group',channelId:{in:['demo-fb-m','demo-fb-q','demo-channel-sms']}}});if(row)await db.resourceBuyerPhone.update({where:{id:row.id},data:{country}});}
 const spends=[['demo-fb-m','QQ','DE',10000],['demo-fb-m','QQ','SG',4000],['demo-fb-m','阳仔','SG',8000],['demo-fb-q','QQ','DE',3000],['demo-channel-sms','短信商甲','SG',2000]];
 const d=new Date();const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-03`;
 for(const [channelId,name,country,amountCents] of spends){
  const buyer=await db.trafficBuyer.findUnique({where:{channelId_name:{channelId,name}}});if(!buyer)continue;
  const entryKey=createHash('sha256').update(JSON.stringify([channelId,buyer.id,country,date,'','USD'])).digest('hex');
  await db.resourceBuyerSpend.upsert({where:{entryKey},update:{},create:{entryKey,channelId,buyerId:buyer.id,country,spendDate:date,currency:'USD',amountCents,note:'本地演示消耗，非真实投放数据',createdById:channelId==='demo-channel-sms'?'demo-resource-sms':'demo-resource-ads'}});
 }
 console.log('本地演示：QQ 德国／新加坡、阳仔新加坡，国家与消耗已就绪。');
}finally{await db.$disconnect();}
