import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { createRowsInput, createSheetRowsInTransaction, patchSheetRowInTransaction, sheetAccess, sheetColumns, normalize, prepareNumberData, validateReplyBeforeJoin, editableFields, assertExpertFields, historicalSheetOwners, SheetError } from "./customer-sheet";
import { syncNumberStatistics } from "./number-statistics";
import { hasAssignedRole } from "./role-access";
import type { SheetData } from "../../packages/customer-sheet/schema";
const inputSchema=createRowsInput.extend({stage:z.enum(["pending","group","expert"]),rowStages:z.array(z.enum(["pending","group","expert"]).nullable()).max(500).optional(),defaults:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({}),choices:z.record(z.string(),z.enum(["keep","replace"])).default({}),preserveUnassignedOperator:z.boolean().default(false),fingerprint:z.string().optional(),includeNew:z.boolean().default(true),includeUpdates:z.boolean().default(true)}).strict();
const empty=(v:unknown)=>v===undefined||v===null||v==="";
export async function planSheetImport(actorId:string,raw:unknown,commit=false){
 const input=inputSchema.parse(raw);
 if(input.rowStages&&input.rowStages.length!==input.rows.length)throw new SheetError("工作表阶段与名单行数不一致，请重新读取文件");
 return db.$transaction(async tx=>{
  const access=await sheetAccess(tx,actorId,input.groupId);if(!access.canCreate)throw new SheetError("此账号不能导入",403);
  const columns=await sheetColumns(tx,input.groupId);
  const people=await tx.user.findMany({where:{groupId:input.groupId,active:true},select:{id:true,name:true}});
  const historicalOwners=access.canChooseHistoricalOwner?await historicalSheetOwners(tx,input.groupId):[];
  const channels=await tx.channel.findMany({where:{groupId:input.groupId,active:true},select:{id:true,name:true}});
  const display=(key:string,v:unknown)=>empty(v)?"未填写":columns.find(c=>c.id===key)?.kind==="member"?people.find(p=>p.id===v)?.name||historicalOwners.find(p=>p.id===v)?.label||String(v):key==="channelId"?channels.find(c=>c.id===v)?.name||String(v):v===true?"是":v===false?"否":String(v);
  const seen=new Set<string>();
  const records: {line:number;phone:string;kind:string;id?:string;version?:number;channel?:{input:string;source:"文件"|"统一值";unified:string};changes:{key:string;label:string;before:string;after:string;conflict:boolean;choice:string;locked:boolean}[];error?:string;values?:SheetData}[]=[];
  for(let i=0;i<input.rows.length;i++){
   const record:typeof records[number]={line:i+1,phone:"",kind:"error",changes:[]};records.push(record);
   try{
    const stage=input.rowStages?.[i]??input.stage;
    const source=Object.fromEntries(Object.entries(input.rows[i]).filter(([,v])=>!empty(v)));
    const phone=String(source.phone||"").replace(/[\s()+-]/g,"");
    if(!/^\d{6,20}$/.test(phone))throw new SheetError("请提供6至20位完整号码，不能使用星号脱敏号码");
    record.phone=phone;
    if(seen.has(phone))throw new SheetError("文件内重复号码，请合并成一行后再导入");seen.add(phone);
    const old=await tx.customerSheetRow.findUnique({where:{groupId_phone:{groupId:input.groupId,phone}}});
    if(old){record.id=old.id;record.version=old.version;record.kind="update";}else record.kind="new";
    const previous:SheetData=old?JSON.parse(old.data):{};
    if(previous.__deletedAt)throw new SheetError("该号码已删除，请先在已删除列表恢复客户，再补充导入",409);
    const defaults=Object.fromEntries(Object.entries(input.defaults).filter(([,v])=>!empty(v)));
    if(stage!=="expert"){delete defaults.expertOn;delete defaults.expertId;}
    if(stage==="pending")delete defaults.joinedOn;
    // Defaults only fill blanks; never move an existing intake owner/channel/date.
    const mergedDefaults=Object.fromEntries(Object.entries(defaults).filter(([k])=>empty(previous[k])));
    const incoming:SheetData={...mergedDefaults,...source,phone};
    if(!empty(incoming.channelId))record.channel={input:String(incoming.channelId).slice(0,80),source:!empty(source.channelId)?"文件":"统一值",unified:empty(defaults.channelId)?"":String(display("channelId",defaults.channelId)).slice(0,80)};
    if(!old){incoming.ownerId ||=actorId;incoming.quality ||= "有效";if(input.preserveUnassignedOperator&&stage==="pending"&&!incoming.operatorId)incoming.operatorId=null;if(!("operatorId" in incoming)&&incoming.ownerId===actorId&&hasAssignedRole(access.actor,"GROUP_OPERATOR"))incoming.operatorId=actorId;}
    for(const k of ["status","expertStatus","progress"])delete incoming[k];
    if(stage==="expert")incoming.addedExpert=true;
    const normalized=await normalize(tx,input.groupId,incoming,columns,previous);
    const allowed=old?editableFields(access.actor,old,columns):[];
    const values:SheetData={};
    for(const [key,value] of Object.entries(normalized)){
     if(old&&key==="phone")continue;
     if(previous[key]===value||empty(value))continue;
     const conflict=!!old&&!empty(previous[key]);
     const locked=!!old&&(key==="ownerId"||!allowed.includes(key));
     const choice=conflict?(input.choices[`${i+1}:${key}`]||"keep"):"replace";
     record.changes.push({key,label:columns.find(c=>c.id===key)?.name||key,before:display(key,previous[key]),after:display(key,value),conflict,choice,locked});
     if(choice==="replace"){
      if(locked)throw new SheetError(key==="ownerId"?"已有客户的接粉归属不能通过批量导入更改":"存在无权修改的字段，请移除该列或由对应负责人导入");
      values[key]=value;
     }
    }
    if(!old&&incoming.operatorId===null){values.operatorId=null;record.changes.push({key:"operatorId",label:"群内负责人",before:"未填写",after:"暂不分配",conflict:false,choice:"replace",locked:false});}
    const final={...previous,...values};
    assertExpertFields(access.actor,values,columns,final.expertId);
    for(const key of ["intakeOn","channelId","ownerId",...(stage==="group"?["joinedOn","operatorId"]:stage==="expert"?["expertOn","expertId","joinedOn","operatorId"]:[])])if(empty(final[key]))throw new SheetError(`缺少${(key==="operatorId"?"群负责人（群操作员）":columns.find(c=>c.id===key)?.name)||key}，请填写或设置统一值`);
    for(const [flag,date] of [["replied","repliedOn"],["normalLeft","normalLeftOn"],["abnormalLeft","abnormalLeftOn"],["addedExpert","expertOn"]])if(final[flag]===true&&!final[date])throw new SheetError(`请补充${columns.find(c=>c.id===date)?.name}，不会自动使用今天`);
    if(final.expertId&&!final.expertOn)throw new SheetError("请补充加专家日期，不会自动使用今天");
    if(Number(final.firstDeposit)>0&&!final.firstDepositOn)throw new SheetError("请补充首充 / 开单日期");
    if(Number(final.investmentTotal)>0&&Number(final.investmentTotal)!==Number(final.firstDeposit||0)&&!old)throw new SheetError("续充请通过资金流水登记金额、日期和方式，不能只导入投资总额");
    if(final.normalLeft===true&&final.abnormalLeft===true)throw new SheetError("正常退群和异常退群不能同时为是，请处理冲突");
    const prepared={...final};prepareNumberData(prepared,previous);validateReplyBeforeJoin(prepared,previous);
    if(!old&&!access.lead){
     const assignedExpertCreatesOldCustomer=final.expertId===actorId&&hasAssignedRole(access.actor,"EXPERT")&&Boolean(final.expertOn);
     if(final.ownerId!==actorId&&!assignedExpertCreatesOldCustomer)throw new SheetError("只有组长或当前专家负责人可以选择其他接粉归属");
    }
    record.values=values;if(old&&!Object.keys(values).length)record.kind="unchanged";
   }catch(e){if(!(e instanceof SheetError))throw e;record.error=e.field==="channelId"&&record.channel?`${record.channel.source}中的${e.message}。${record.channel.source==="文件"&&record.channel.unified?`上方统一渠道“${record.channel.unified}”只补空白，不覆盖文件渠道；请修改文件该行后重新读取，或取消渠道列映射后统一填写。`:"请修正后重新检查。"}`:e.message;}
  }
  const fingerprint=createHash("sha256").update(JSON.stringify({actorId,groupId:input.groupId,stage:input.stage,rowStages:input.rowStages,records})).digest("hex");
  if(commit){
   if(!input.fingerprint||input.fingerprint!==fingerprint)throw new SheetError("预览后资料或选择已变化，请重新预览再确认",409);
   const selected=records.filter(r=>r.kind==="new"?input.includeNew:r.kind==="update"||r.kind==="unchanged"?input.includeUpdates:true);
   if(selected.some(r=>r.error))throw new SheetError("有未处理的错误，请修正后重新预览");
   let added=0,updated=0;
   for(const r of selected){
    if(r.kind==="new"){await createSheetRowsInTransaction(tx,actorId,{groupId:input.groupId,rows:[r.values!]},false);added++;}
    if(r.kind==="update"){await patchSheetRowInTransaction(tx,actorId,r.id!,{version:r.version!,values:r.values},false);updated++;}
   }
   if(!added&&!updated)throw new SheetError("没有选择可保存的新增或更新记录");
   await syncNumberStatistics(tx,input.groupId,actorId);
   return {added,updated,skipped:records.length-added-updated};
  }
  return {fingerprint,records:records.map(({values,...record})=>record),added:records.filter(r=>!r.error&&r.kind==="new").length,updated:records.filter(r=>!r.error&&r.kind==="update").length,unchanged:records.filter(r=>!r.error&&r.kind==="unchanged").length,errors:records.filter(r=>r.error).length};
 },{timeout:60000});
}
