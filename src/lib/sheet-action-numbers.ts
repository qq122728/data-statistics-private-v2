import type { Prisma } from '@prisma/client';
import type { SheetData } from '../../packages/customer-sheet/schema';
import { customerActions, type ActionNumber } from '../../packages/customer-sheet/action-numbers';
/** Called inside the row transaction. A retry cannot consume or duplicate a committed number. */
export async function assignActionNumbers(tx:Prisma.TransactionClient,groupId:string,d:SheetData){
 const allocated:Record<string,string>=d.__actionNumberHistory?JSON.parse(String(d.__actionNumberHistory)):{};
 const active:ActionNumber[]=[];
 for(const event of customerActions(d)){
  const identity=JSON.stringify([event.key,event.action,event.date]);
  if(!allocated[identity]){
   const counter=await tx.sheetActionSequence.upsert({where:{groupId_action_date:{groupId,action:event.action,date:event.date}},create:{groupId,action:event.action,date:event.date,value:1},update:{value:{increment:1}}});
   const [,month,day]=event.date.split('-');
   allocated[identity]=`${event.action}-${Number(month)}-${Number(day)}-${String(counter.value).padStart(3,'0')}`;
  }
  active.push({...event,code:allocated[identity]});
 }
 d.__actionNumberHistory=JSON.stringify(allocated);
 d.__actionNumbers=JSON.stringify(active);
}
