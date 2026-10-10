import type { Prisma } from "@prisma/client";
import { inGroupDelta } from "../../packages/customer-sheet/in-group";
type Counts={joinCount:number;normalLeaveCount:number;abnormalLeaveCount:number;currentInGroupCount:number};
type Entry={groupId:string;channelId:string;ownerId:string;businessDate:string;position:string;status?:string;currentRevision:Counts|null;approvedRevision:Counts|null};
export function withRunningInGroup<T extends Entry>(entries:T[]):T[]{
 const totals=new Map<string,number>();const counts=new Map<T,number>();
 for(const e of [...entries].sort((a,b)=>a.businessDate.localeCompare(b.businessDate))){
  if(e.position!=="RECEPTION"||e.status==="RETURNED")continue;
  const v=e.currentRevision??e.approvedRevision;if(!v)continue;
  const key=JSON.stringify([e.groupId,e.ownerId,e.channelId]);
  const total=(totals.get(key)||0)+inGroupDelta(v);totals.set(key,total);counts.set(e,total);
 }
 return entries.map(e=>counts.has(e)?{...e,currentRevision:e.currentRevision?{...e.currentRevision,currentInGroupCount:counts.get(e)!}:null,approvedRevision:e.approvedRevision?{...e.approvedRevision,currentInGroupCount:counts.get(e)!}:null}:e);
}
export async function currentInGroupBefore(tx:Prisma.TransactionClient,ownerId:string,groupId:string,channelId:string,before:string){
 const entries=await tx.dailyStatEntry.findMany({where:{ownerId,groupId,channelId,position:"RECEPTION",status:{not:"RETURNED"},businessDate:{lt:before}},select:{currentRevision:{select:{joinCount:true,normalLeaveCount:true,abnormalLeaveCount:true}}}});
 return entries.reduce((n,e)=>n+(e.currentRevision?inGroupDelta(e.currentRevision):0),0);
}
