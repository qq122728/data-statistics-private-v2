import type { SheetData } from './schema';
import { recharges } from './investment';
export type ActionNumber = {key:string; action:string; label:string; date:string; code:string};
export function customerActions(d:SheetData):Omit<ActionNumber,'code'>[]{
 if(!d.intakeOn||!d.channelId)return [];
 const list:Omit<ActionNumber,'code'>[]=[];
 const add=(key:string,action:string,label:string,date:unknown)=>{if(date)list.push({key,action,label,date:String(date).slice(0,10)});};
 add('intakeOn','G','接粉',d.intakeOn);
 if(d.replied===true)add('repliedOn','H','回复',d.repliedOn);
 add('joinedOn','J','进群',d.joinedOn);
 if(d.normalLeft===true)add('normalLeftOn','T','正常退群',d.normalLeftOn);
 if(d.abnormalLeft===true)add('abnormalLeftOn','Y','异常退群',d.abnormalLeftOn);
 if(d.addedExpert===true||d.expertOn)add('expertOn','Z','推专家',d.expertOn);
 add('registeredOn','R','注册',d.registeredOn);
 if(Number(d.firstDeposit)>0)add('firstDepositOn','S','首充 / 开单',d.firstDepositOn);
 for(const r of recharges(d))add(r.id,r.kind==='withdrawal'?'C':'X',r.kind==='withdrawal'?'出金':'续充',r.date);
 return list;
}
export function actionNumbers(d:SheetData):ActionNumber[]{return d.__actionNumbers?JSON.parse(String(d.__actionNumbers)):[];}
export function fieldActionNumber(d:SheetData,field:string){return actionNumbers(d).find(n=>n.key===(field==='phone'?'intakeOn':field))?.code;}
