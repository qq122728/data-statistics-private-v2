import type { SheetData } from './schema';
import { recharges } from './investment';
export const numberMetrics = [
 ['dispatchCount','添加数据'],['duplicateCount','撞粉'],['lowAmountCount','低金额'],['noWsCount','无 WS 号码'],['manualInvalidCount','人工无效'],['effectiveCount','有效数据'],['replyCount','回复'],['joinCount','进群'],['normalLeaveCount','正常退群'],['abnormalLeaveCount','异常退群'],['expertIntroCount','推专家'],['registrationCount','注册'],['orderCount','开单'],['bankInitialDepositCents','首充 · 银行卡'],['cryptoInitialDepositCents','首充 · 加密货币'],['bankRechargeCents','续充 · 银行卡'],['cryptoRechargeCents','续充 · 加密货币'],['withdrawalCents','出金'],
] as const;
export type NumberMetric = typeof numberMetrics[number][0];
export type NumberValues = Record<NumberMetric,number>;
export function emptyNumberValues():NumberValues{return Object.fromEntries(numberMetrics.map(([k])=>[k,0])) as NumberValues;}
export type NumberEvent={date:string;field:NumberMetric;value:number};
/** A tracked customer keeps its original intake date after it leaves the pending view. */
export function numberEvents(d:SheetData):NumberEvent[]{
 if(d.__deletedAt||!d.intakeOn||!d.channelId)return [];
 const events:NumberEvent[]=[];
 const add=(date:unknown,field:NumberMetric,value=1)=>{if(date&&value)events.push({date:String(date).slice(0,10),field,value});};
 add(d.intakeOn,'dispatchCount');
 const invalid:Record<string,NumberMetric>={'撞粉':'duplicateCount','低金额':'lowAmountCount','无 WS 号码':'noWsCount','人工无效':'manualInvalidCount'};
 const quality=invalid[String(d.quality)];add(d.intakeOn,quality||'effectiveCount');
 if(d.replied===true)add(d.repliedOn,'replyCount');
 add(d.joinedOn,'joinCount');
 if(d.normalLeft===true)add(d.normalLeftOn,'normalLeaveCount');
 if(d.abnormalLeft===true)add(d.abnormalLeftOn,'abnormalLeaveCount');
 if(d.addedExpert!==false&&(d.addedExpert===true||d.expertOn))add(d.expertOn,'expertIntroCount');
 add(d.registeredOn,'registrationCount');
 if(Number(d.firstDeposit)>0){add(d.firstDepositOn,'orderCount');add(d.firstDepositOn,d.firstDepositMethod==='银行卡'?'bankInitialDepositCents':'cryptoInitialDepositCents',Math.round(Number(d.firstDeposit)*100));}
 for(const item of recharges(d))add(item.date,item.kind==='withdrawal'?'withdrawalCents':item.method==='bank'?'bankRechargeCents':'cryptoRechargeCents',item.amountCents);
 return events;
}
