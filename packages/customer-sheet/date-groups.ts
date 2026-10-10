import type { SheetData } from "./schema";
import { fieldActionNumber } from "./action-numbers";
export function dateField(stage: string | null) { return stage === "pending" ? "intakeOn" : stage === "expert" ? "expertOn" : "joinedOn"; }
export function rowDate(data: SheetData, stage: string | null) { return String(data[dateField(stage)] || "").slice(0, 10); }
export function compareDatedRows(a: {id:string; data:SheetData}, b: {id:string; data:SheetData}, stage:string|null) {
 const ad=rowDate(a.data,stage), bd=rowDate(b.data,stage);
 if(ad!==bd)return ad ? bd ? bd.localeCompare(ad) : -1 : 1;
 const number=(d:SheetData)=>Number(fieldActionNumber(d,dateField(stage))?.split("-").at(-1) || Number.MAX_SAFE_INTEGER);
 return number(a.data)-number(b.data) || a.id.localeCompare(b.id);
}
export function previousDate(today:string) { const d=new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10); }
