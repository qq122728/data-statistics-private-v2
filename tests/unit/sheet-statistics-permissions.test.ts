import { randomUUID } from 'node:crypto';
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import * as auth from '../../src/lib/auth';
import { db } from '../../src/lib/db';
import { GET } from '../../src/app/api/customer-sheet/statistics/route';

const groupId = randomUUID();
const channelId = randomUUID();
const users: Record<string, any> = {};
beforeAll(async () => {
 await db.teamGroup.create({data:{id:groupId,name:groupId}});
 await db.channel.create({data:{id:channelId,groupId,name:'A',normalizedName:'a'}});
 for(const role of ['RECEPTION','GROUP_OPERATOR','EXPERT','LEAD','ADMIN'] as const){
  const id=randomUUID();users[role]=await db.user.create({data:{id,username:id,name:role,role,groupId}});
 }
 for(const [index,owner,statisticsOwner] of [
  [1,'RECEPTION',null], [2,'GROUP_OPERATOR',null], [3,'EXPERT',null],
  // Handover retains the original intake attribution.
  [4,'GROUP_OPERATOR','RECEPTION'],
 ] as const){
  await db.customerSheetRow.create({data:{groupId,ownerId:users[owner].id,phone:String(990000+index),data:JSON.stringify({channelId,intakeOn:'2026-09-01',replied:true,repliedOn:'2026-09-02',firstDeposit:10,firstDepositOn:'2026-09-02',firstDepositMethod:'银行卡',...(statisticsOwner?{__statisticsOwnerId:users[statisticsOwner].id}:{})})}});
 }
});
afterEach(()=>vi.restoreAllMocks());
async function query(role:string,params:string){
 vi.spyOn(auth,'requireUser').mockResolvedValue(users[role]);
 return GET(new Request(`http://localhost/api/customer-sheet/statistics?groupId=${groupId}&from=2026-09-01&to=2026-09-08&${params}`));
}
it.each(['','mine=0','mine=false','mine=1','mine=0&ownerId=anything'])('普通组员不能通过参数扩大统计范围：%s',async params=>{
 const response=await query('RECEPTION',params);expect(response.status).toBe(200);
 const result=await response.json();
 expect(result).toMatchObject({scope:'self',canViewGroup:false,total:{dispatchCount:2,replyCount:2,bankInitialDepositCents:2000}});
 expect(result.channels[0].values.replyCount).toBe(2);
});
it.each(['GROUP_OPERATOR','EXPERT'])('%s 也只统计本人原接粉',async role=>{
 const result=await (await query(role,'mine=0&basis=intake')).json();
 expect(result).toMatchObject({scope:'self',canViewGroup:false,total:{dispatchCount:1,replyCount:1}});
});
it.each(['LEAD','ADMIN'])('%s 可看全组，也能主动缩小范围',async role=>{
 const all=await (await query(role,'mine=0')).json();
 expect(all).toMatchObject({scope:'group',canViewGroup:true,total:{dispatchCount:4,replyCount:4}});
 const own=await (await query(role,'mine=1')).json();
 expect(own).toMatchObject({scope:'self',total:{dispatchCount:0,replyCount:0}});
});
it('组员不能通过修改 groupId 查看其他组',async()=>{
 vi.spyOn(auth,'requireUser').mockResolvedValue(users.RECEPTION);
 const response=await GET(new Request('http://localhost/api/customer-sheet/statistics?groupId=group-b&mine=0'));
 expect(response.status).toBe(403);
});
it('权限变更后按数据库实时身份判断',async()=>{
 const actor=users.LEAD;
 vi.spyOn(auth,'requireUser').mockResolvedValue(actor);
 await db.user.update({where:{id:actor.id},data:{role:'RECEPTION'}});
 try {const result=await (await GET(new Request(`http://localhost/api/customer-sheet/statistics?groupId=${groupId}&mine=0`))).json();expect(result).toMatchObject({scope:'self',canViewGroup:false});}
 finally {await db.user.update({where:{id:actor.id},data:{role:'LEAD'}});}
});
