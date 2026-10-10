import type { SheetData } from '../../packages/customer-sheet/schema';
import { sheetStatisticsGroup, sheetStatisticsOwner } from '../../packages/customer-sheet/statistics-owner';
import { db } from './db';
import { isCalendarDate } from './dates';
import type { CurrentInGroupCustomer } from './current-in-group-customers';

export const NUMBER_REPORT_FROM = '2026-09-01';
export const isNumberReportDate = (date: string) => date >= NUMBER_REPORT_FROM;

// 与进群、退群事件一样按填写的业务日期计算，不把时间转换成其他时区。
function businessDay(value: unknown) {
  const day = typeof value === 'string' ? value.slice(0, 10) : '';
  return isCalendarDate(day) ? day : null;
}

export function isSheetInGroupAt(data: SheetData, asOf: string) {
  const cutoff = businessDay(asOf);
  const joined = businessDay(data.joinedOn);
  if (data.__deletedAt || !data.intakeOn || !data.channelId || !cutoff || !joined || joined > cutoff) return false;
  const normalLeft = businessDay(data.normalLeftOn);
  const abnormalLeft = businessDay(data.abnormalLeftOn);
  if (data.normalLeft === true && normalLeft && normalLeft <= cutoff) return false;
  if (data.abnormalLeft === true && abnormalLeft && abnormalLeft <= cutoff) return false;
  return true;
}

/** 原始历史日报只取各业务线最后一次保存的存量，不能再按新规则累计接粉流量。 */
export function sumSavedHistoricalStock(entries: Array<{
  groupId: string; channelId: string; ownerId: string; sourceReceptionId: string | null;
  businessDate: string; position: string;
  currentRevision?: { currentInGroupCount: number } | null;
  approvedRevision: { currentInGroupCount: number } | null;
}>) {
  const latest = new Map<string, {date: string; count: number}>();
  for (const e of entries) {
    const v = e.currentRevision ?? e.approvedRevision;
    if (!v || !['RECEPTION','GROUP_OPERATOR'].includes(e.position)) continue;
    const key = JSON.stringify([e.position,e.groupId,e.channelId,e.ownerId,e.position==='GROUP_OPERATOR'?e.sourceReceptionId:null]);
    const old = latest.get(key);
    if (!old || e.businessDate > old.date) latest.set(key,{date:e.businessDate,count:v.currentInGroupCount});
    else if (e.businessDate === old.date) old.count += v.currentInGroupCount;
  }
  return [...latest.values()].reduce((n,v)=>n+v.count,0);
}

export async function loadManagementSheetStock(groupIds: string[], asOf: string, client: Pick<typeof db, "customerSheetRow" | "channel" | "user"> = db): Promise<CurrentInGroupCustomer[]> {
  if (!groupIds.length || !isNumberReportDate(asOf)) return [];
  const rows = await client.customerSheetRow.findMany({where:{OR:[{groupId:{in:groupIds}},...groupIds.map(id=>({data:{contains:`"__statisticsGroupId":${JSON.stringify(id)}`}}))]},select:{groupId:true,ownerId:true,data:true}});
  const [channels,people]=await Promise.all([
    client.channel.findMany({where:{groupId:{in:groupIds}},select:{id:true,name:true,normalizedName:true}}),
    client.user.findMany({select:{id:true,name:true}}),
  ]);
  const channelMap=new Map(channels.map(c=>[c.id,c]));const peopleMap=new Map(people.map(p=>[p.id,p]));
  return rows.flatMap(row=>{
    const d=JSON.parse(row.data) as SheetData;const groupId=sheetStatisticsGroup(row.groupId,d);
    if(!groupIds.includes(groupId)||!isSheetInGroupAt(d,asOf))return [];
    const channel=channelMap.get(String(d.channelId));const ownerId=sheetStatisticsOwner(row.ownerId,d);
    if(!channel)return [];
    return [{groupId,channel,member:peopleMap.get(ownerId)??{id:ownerId,name:'历史归属'}}];
  });
}
