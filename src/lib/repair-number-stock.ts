import type { Prisma } from '@prisma/client';
import {loadNumberStockCounter} from './number-stock';
import {NUMBER_REPORT_FROM} from './management-report-stock';

/** Snapshot-only repair: preserve every flow/finance value and all previous revisions. */
export async function repairNumberStock(tx:Prisma.TransactionClient,groupId:string,apply=false){
 const group=await tx.teamGroup.findUniqueOrThrow({where:{id:groupId},select:{groupType:true}});
 if(group.groupType!=='HACKER')return [];
 const count=await loadNumberStockCounter(groupId,tx);
 const entries=await tx.dailyStatEntry.findMany({where:{groupId,sourceMode:'NUMBER',position:'RECEPTION',businessDate:{gte:NUMBER_REPORT_FROM}},include:{currentRevision:true}});
 const changes=[];
 for(const entry of entries){
  const previous=entry.currentRevision;if(!previous)continue;
  const after=count(entry.businessDate,entry.ownerId,entry.channelId);
  if(after===previous.currentInGroupCount)continue;
  changes.push({entryId:entry.id,ownerId:entry.ownerId,date:entry.businessDate,before:previous.currentInGroupCount,after});
  if(apply){
   const {id:revisionId,createdAt,...values}=previous;
   const revision=await tx.dailyStatRevision.create({data:{...values,version:previous.version+1,currentInGroupCount:after,changeReason:'修正在群快照：9月起只按客户号码统计，不承接8月历史存量'}});
   await tx.dailyStatEntry.update({where:{id:entry.id},data:{currentRevisionId:revision.id,...(entry.approvedRevisionId===revisionId?{approvedRevisionId:revision.id}:{})}});
  }
 }
 return changes;
}
