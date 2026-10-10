import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { isNumberReportDate, isSheetInGroupAt } from "./management-report-stock";
import { sheetStatisticsGroup, sheetStatisticsGroupWhere, sheetStatisticsOwner } from "../../packages/customer-sheet/statistics-owner";
import type { SheetData } from "../../packages/customer-sheet/schema";

/** Load once, then count actual customer records at each requested business date. */
export async function loadNumberStockCounter(groupId: string, client: Pick<Prisma.TransactionClient, "customerSheetRow"> = db) {
  const records = await client.customerSheetRow.findMany({where:sheetStatisticsGroupWhere(groupId), select:{groupId:true,ownerId:true,data:true}});
  const rows = records.map(row=>({data:JSON.parse(row.data) as SheetData, row})).filter(({row,data})=>sheetStatisticsGroup(row.groupId,data)===groupId);
  return (asOf: string, ownerId?: string, channelId?: string) => !isNumberReportDate(asOf) ? 0 : rows.filter(({row,data})=>
    (!ownerId || sheetStatisticsOwner(row.ownerId,data)===ownerId) && (!channelId || data.channelId===channelId) && isSheetInGroupAt(data,asOf)).length;
}

type Entry = {businessDate:string;ownerId:string;channelId:string;position:string;currentRevision:{currentInGroupCount:number}|null;approvedRevision:{currentInGroupCount:number}|null};
export function withNumberStock<T extends Entry>(entries:T[], count:Awaited<ReturnType<typeof loadNumberStockCounter>>):T[] {
  return entries.map(e=>{
    if(e.position!=="RECEPTION" || !isNumberReportDate(e.businessDate))return e;
    const currentInGroupCount=count(e.businessDate,e.ownerId,e.channelId);
    return {...e,currentRevision:e.currentRevision?{...e.currentRevision,currentInGroupCount}:null,approvedRevision:e.approvedRevision?{...e.approvedRevision,currentInGroupCount}:null};
  });
}
