import { sheetStatisticsOwner, sheetStatisticsGroup, sheetStatisticsGroupWhere } from '../../packages/customer-sheet/statistics-owner';
import type { Prisma } from '@prisma/client';
import { emptyNumberValues, numberEvents, numberMetrics } from '../../packages/customer-sheet/number-statistics';
import type { SheetData } from '../../packages/customer-sheet/schema';
import { STATISTICS_TIMEZONE } from './statistics-date';
import { loadNumberStockCounter } from "./number-stock";
import { isNumberReportDate } from "./management-report-stock";
import { currentInGroupBefore } from './cumulative-in-group';
import { inGroupDelta } from '../../packages/customer-sheet/in-group';

/** Rebuild affected group buckets atomically with customer edits; never apply increment retries. */
export async function syncNumberStatistics(tx:Prisma.TransactionClient,groupId:string,actorId:string,removedSourceGroupIds:string[]=[]){
 const currentRows=await tx.customerSheetRow.findMany({where:{groupId},select:{groupId:true,data:true}});
 const groups=new Set([groupId,...removedSourceGroupIds,...currentRows.map(row=>sheetStatisticsGroup(row.groupId,JSON.parse(row.data)))]);
 for(const sourceGroupId of groups)await rebuildGroup(tx,sourceGroupId,actorId);
}
async function rebuildGroup(tx:Prisma.TransactionClient,groupId:string,actorId:string){
 // The reporting source determines the business mode, even after a cross-group transfer.
 // Lawyer groups keep their manual daily figures, revisions and finance untouched.
 const group=await tx.teamGroup.findUnique({where:{id:groupId},select:{groupType:true}});
 if(group?.groupType!=="HACKER")return;
 const [rows,oldEntries]=await Promise.all([
  tx.customerSheetRow.findMany({where:sheetStatisticsGroupWhere(groupId)}),
  tx.dailyStatEntry.findMany({where:{groupId,sourceMode:'NUMBER'},include:{currentRevision:true}}),
 ]);
 const countStock=await loadNumberStockCounter(groupId,tx);
 const buckets=new Map<string,{ownerId:string;channelId:string;date:string;values:ReturnType<typeof emptyNumberValues>}>();
 const bucket=(ownerId:string,channelId:string,date:string)=>{
  const key=JSON.stringify([ownerId,channelId,date]);
  if(!buckets.has(key))buckets.set(key,{ownerId,channelId,date,values:emptyNumberValues()});
  return buckets.get(key)!;
 };
 for(const old of oldEntries)bucket(old.ownerId,old.channelId,old.businessDate);
 for(const row of rows){const d:SheetData=JSON.parse(row.data);if(sheetStatisticsGroup(row.groupId,d)!==groupId)continue;for(const event of numberEvents(d))bucket(sheetStatisticsOwner(row.ownerId,d),String(d.channelId),event.date).values[event.field]+=event.value;}
 for(const b of [...buckets.values()].sort((a,b)=>a.date.localeCompare(b.date))){
  const identityKey=`unified-member-v1:${JSON.stringify([b.ownerId,groupId,b.date,'RECEPTION',b.channelId,b.ownerId,null])}`;
  const old=await tx.dailyStatEntry.findUnique({where:{identityKey},include:{currentRevision:true}});
  const currentInGroupCount=isNumberReportDate(b.date)?countStock(b.date,b.ownerId,b.channelId):await currentInGroupBefore(tx,b.ownerId,groupId,b.channelId,b.date)+inGroupDelta(b.values);
  if(old?.sourceMode==='NUMBER'&&numberMetrics.every(([key])=>Number(old.currentRevision?.[key]||0)===b.values[key])&&(!isNumberReportDate(b.date)||old.currentRevision?.currentInGroupCount===currentInGroupCount))continue;
  const entry=old??await tx.dailyStatEntry.create({data:{identityKey,ownerId:b.ownerId,groupId,channelId:b.channelId,businessDate:b.date,timezone:STATISTICS_TIMEZONE,position:'RECEPTION',sourceReceptionId:b.ownerId,sourceMode:'NUMBER'}});
  const previous=old?.currentRevision;
  const revision=await tx.dailyStatRevision.create({data:{...b.values,currentInGroupCount,lawyerRealCaseCount:previous?.lawyerRealCaseCount??0,lawyerAddedCount:previous?.lawyerAddedCount??0,lawyerExpertAddedCount:previous?.lawyerExpertAddedCount??0,customerServicePushCount:previous?.customerServicePushCount??0,entryId:entry.id,version:(previous?.version??0)+1,createdById:actorId,changeReason:'号码及资金流水自动汇总'}});
  await tx.dailyStatEntry.update({where:{id:entry.id},data:{sourceMode:'NUMBER',currentRevisionId:revision.id,approvedRevisionId:revision.id,status:'APPROVED',submittedAt:new Date()}});
 }
}
