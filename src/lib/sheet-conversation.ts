import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "./db";
import {sheetAccess,sheetColumns,SheetError,patchSheetRowInTransaction,addSheetRechargeInTransaction} from "./customer-sheet";
import {planSheetImport} from "./sheet-import-plan";
import {syncNumberStatistics} from "./number-statistics";
import type {SheetData} from "../../packages/customer-sheet/schema";
const values=z.record(z.string(),z.union([z.string().max(4000),z.number(),z.boolean(),z.null()]));
const schema=z.object({groupId:z.string(),mode:z.enum(["auto","import","update"]).default("auto"),stage:z.enum(["pending","group","expert"]).optional(),rows:z.array(values).min(1).max(500),defaults:values.default({}),rowStages:z.array(z.enum(["pending","group","expert"]).nullable()).optional(),choices:z.record(z.string(),z.enum(["keep","replace"])).default({}),fund:z.object({amount:z.number().positive(),date:z.string(),method:z.enum(["bank","crypto"]),kind:z.enum(["recharge","withdrawal"]),requestId:z.string().uuid()}).optional(),fingerprint:z.string().optional()}).strict();
class Preview extends Error{constructor(public result:unknown){super("preview rollback");}}
const empty=(v:unknown)=>v===undefined||v===null||v==="";
export async function sheetConversation(actorId:string,raw:unknown,commit=false){
 const input=schema.parse(raw);
 const phones=input.rows.map(r=>String(r.phone||"").replace(/[\s()+-]/g,""));
 if(phones.some(p=>!/^\d{6,20}$/.test(p)))throw new SheetError("请提供6至20位完整客户号码，不能只用末几位或星号号码");
 if(new Set(phones).size!==phones.length)throw new SheetError("名单有重复号码，请每个客户只保留一次");
 const existing=await db.$transaction(async tx=>{await sheetAccess(tx,actorId,input.groupId);return tx.customerSheetRow.findMany({where:{groupId:input.groupId,phone:{in:phones}},select:{phone:true}});});
 const update=input.mode==="update"||!!input.fund||input.mode==="auto"&&existing.length===phones.length;
 if(!update){
  if(!input.stage&&!input.rowStages?.every(Boolean))throw new SheetError("这批客户要导入待进群、在群跟进，还是专家跟进？");
  const newRows=input.rows.filter((_,i)=>!existing.some(r=>r.phone===phones[i]));
  if(newRows.some(r=>empty(r.ownerId)&&empty(input.defaults.ownerId)))throw new SheetError("接粉负责人是谁？请回复本组姓名，或说接粉负责人是我");
  if(input.rows.some((r,i)=>!existing.some(e=>e.phone===phones[i])&&(input.rowStages?.[i]||input.stage)!=="pending"&&empty(r.operatorId)&&empty(input.defaults.operatorId)))throw new SheetError("在群或专家阶段需要群内负责人，不能跳过。群内负责人是谁？如尚未进群，请先按待进群导入");
  const plan=await planSheetImport(actorId,{groupId:input.groupId,stage:input.stage||"pending",rows:input.rows,defaults:input.defaults,rowStages:input.rowStages,choices:input.choices,fingerprint:input.fingerprint,preserveUnassignedOperator:true},commit);
  return {mode:"import",...plan};
 }
 if(phones.length>50)throw new SheetError("更新已有客户每次最多50人，请分批发送");
 if(existing.length!==phones.length)throw new SheetError("部分号码在本组不存在，不能作为进度更新。请核对号码，或明确要新增导入");
 try{return await db.$transaction(async tx=>{
  const columns=await sheetColumns(tx,input.groupId);
  const people=await tx.user.findMany({where:{groupId:input.groupId},select:{id:true,name:true}});
  const channels=await tx.channel.findMany({where:{groupId:input.groupId},select:{id:true,name:true}});
  const display=(key:string,v:unknown)=>empty(v)?"未填写":columns.find(c=>c.id===key)?.kind==="member"?people.find(p=>p.id===v)?.name||String(v):key==="channelId"?channels.find(c=>c.id===v)?.name||String(v):v===true?"是":v===false?"否":String(v);
  const rows=await tx.customerSheetRow.findMany({where:{groupId:input.groupId,phone:{in:phones}}});
  const fingerprint=createHash("sha256").update(JSON.stringify({actorId,input:{...input,fingerprint:undefined},versions:phones.map(p=>{const r=rows.find(r=>r.phone===p);return [r?.id,r?.version];})})).digest("hex");
  if(commit&&input.fingerprint!==fingerprint)throw new SheetError("客户或修改内容已变化，请重新核对摘要后再确认",409);
  const records=[];
  for(let i=0;i<phones.length;i++){
   const row=rows.find(r=>r.phone===phones[i]);if(!row)throw new SheetError("客户已变化，请重新核对",409);
   const previous:SheetData=JSON.parse(row.data);
   const patch={...input.defaults,...input.rows[i]};delete patch.phone;
   if("ownerId" in patch&&patch.ownerId===row.ownerId)delete patch.ownerId;
   const merged={...previous,...patch};
   for(const [flag,date,label] of [["replied","repliedOn","回复"],["addedExpert","expertOn","加专家"],["normalLeft","normalLeftOn","正常退群"],["abnormalLeft","abnormalLeftOn","异常退群"]])if((patch[flag]===true||patch[flag]==="是")&&empty(merged[date]))throw new SheetError(`请补充实际${label}日期，不能自动当作今天`);
   if(patch.joinedOn&&!merged.repliedOn)throw new SheetError("请补充实际回复日期，再确认进群");
   if(patch.expertId&&!merged.expertOn)throw new SheetError("请补充实际加专家日期");
   if((patch.addedExpert===true||patch.addedExpert==="是"||patch.expertOn)&&!merged.expertId)throw new SheetError("专家负责人是谁？请先指定本组专家");
   if(patch.joinedOn&&!merged.operatorId)throw new SheetError("群内负责人是谁？请先补充群负责人");
   if(Number(patch.firstDeposit)>0&&(!merged.firstDepositOn||!merged.firstDepositMethod))throw new SheetError("请补充首充实际日期和方式（银行卡或加密货币）");
   let version=row.version;
   let after=previous;
   if(Object.keys(patch).length){const changed=await patchSheetRowInTransaction(tx,actorId,row.id,{version,values:patch},false);version=changed.version;after=JSON.parse((await tx.customerSheetRow.findUniqueOrThrow({where:{id:row.id}})).data);}
   if(input.fund){await addSheetRechargeInTransaction(tx,actorId,row.id,{...input.fund,version},false);}
   if(!Object.keys(patch).length&&!input.fund)throw new SheetError("要更新这些客户的哪项进度？请说明动作和实际发生日期");
   const changes=columns.filter(c=>c.id!=="phone"&&previous[c.id]!==after[c.id]).map(c=>({key:c.id,label:c.name,before:display(c.id,previous[c.id]),after:display(c.id,after[c.id]),conflict:false,choice:"replace",locked:false}));
   if(input.fund)changes.push({key:"fund",label:input.fund.kind==="withdrawal"?"新增出金流水":"新增续充流水",before:"",after:`${input.fund.date} · ${input.fund.amount} · ${input.fund.method==="bank"?"银行卡":"加密货币"}`,conflict:false,choice:"replace",locked:false});
   records.push({line:i+1,phone:row.phone,kind:"update",changes});
  }
  const result={mode:"update",fingerprint,added:0,updated:records.length,unchanged:0,records};
  if(!commit)throw new Preview(result);
  await syncNumberStatistics(tx,input.groupId,actorId);
  return {mode:"update",added:0,updated:records.length,skipped:0};
 },{timeout:60000});}catch(e){if(e instanceof Preview)return e.result;throw e;}
}
