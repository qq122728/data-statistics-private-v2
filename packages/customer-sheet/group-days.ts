import type { SheetData } from './schema';

/** Inclusive day number in group, using the same business date as the daily report. */
export function groupDays(data:SheetData,today:string):number|null {
 const parse=(value:unknown)=>{
  const day=String(value??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return NaN;
  const time=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===day?time:NaN;
 };
 const start=parse(data.joinedOn);
 const end=parse(data.abnormalLeft===true?data.abnormalLeftOn:data.normalLeft===true?data.normalLeftOn:today);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
 return Math.floor((end-start)/86400000)+1;
}
