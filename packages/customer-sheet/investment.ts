import type { SheetData } from "./schema";
export type Recharge={id:string;kind?:"recharge"|"withdrawal";amountCents:number;date:string;method:"bank"|"crypto";actorId:string;createdAt:string};
export function recharges(data:SheetData):Recharge[]{
 return data.__recharges?JSON.parse(String(data.__recharges)) as Recharge[]:[];
}
export function investmentSummary(data:SheetData){
 const entries=recharges(data);
 const firstCents=Math.round(Number(data.firstDeposit||0)*100);
 const rechargeCents=entries.filter(r=>r.kind!=="withdrawal").reduce((sum,r)=>sum+r.amountCents,0);
 const baseCents=data.__investmentBaseCents!=null?Number(data.__investmentBaseCents):Math.max(0,Math.round(Number(data.investmentTotal||0)*100)-firstCents-rechargeCents);
 const withdrawalCents=entries.filter(r=>r.kind==="withdrawal").reduce((sum,r)=>sum+r.amountCents,0);
 return {withdrawalCents,entries,firstCents,rechargeCents,baseCents,totalCents:baseCents+firstCents+rechargeCents};
}
