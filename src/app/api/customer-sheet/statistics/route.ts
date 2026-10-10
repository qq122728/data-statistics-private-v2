import { sheetStatisticsOwner, sheetStatisticsGroup, sheetStatisticsGroupWhere } from '../../../../../packages/customer-sheet/statistics-owner';
import { sheetHttp } from '../../../../lib/customer-sheet-http';
import { sheetAccess, SheetError } from '../../../../lib/customer-sheet';
import { db } from '../../../../lib/db';
import { statisticsDate } from '../../../../lib/statistics-date';
import { emptyNumberValues, numberEvents } from '../../../../../packages/customer-sheet/number-statistics';
import type { SheetData } from '../../../../../packages/customer-sheet/schema';
export async function GET(request:Request){return sheetHttp(async actorId=>{
 const p=new URL(request.url).searchParams;const groupId=p.get('groupId')||'';const today=statisticsDate();const from=p.get('from')||today;const to=p.get('to')||from;const basis=p.get('basis')==='intake'?'intake':'event';
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to)throw new SheetError('日期范围不正确');
 return db.$transaction(async tx=>{
  const access = await sheetAccess(tx,actorId,groupId);
  // Query parameters may narrow an authorized scope, never broaden it.
  const onlyMine = !access.canViewGroupStatistics || p.get('mine')==='1';
  const [rows,channels]=await Promise.all([tx.customerSheetRow.findMany({where:sheetStatisticsGroupWhere(groupId)}),tx.channel.findMany({where:{groupId},select:{id:true,name:true}})]);
  const total=emptyNumberValues();const byChannel=channels.map(c=>({...c,values:emptyNumberValues()}));
  for(const row of rows){const d:SheetData=JSON.parse(row.data);if(sheetStatisticsGroup(row.groupId,d)!==groupId)continue;if(onlyMine&&sheetStatisticsOwner(row.ownerId,d)!==actorId)continue;const channel=byChannel.find(c=>c.id===d.channelId);if(!channel)continue;
   for(const event of numberEvents(d)){const date=basis==='intake'?String(d.intakeOn):event.date;if(date<from||date>to)continue;total[event.field]+=event.value;channel.values[event.field]+=event.value;}
  }
  return {today,from,to,basis,total,channels:byChannel,canViewGroup:access.canViewGroupStatistics,scope:onlyMine?'self':'group'};
 });
});}
