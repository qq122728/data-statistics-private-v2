import { normalizeCustomerQuery } from "../../packages/customer-sheet/search-query";
import { customerStage, inCustomerView, customerPageSize, type CustomerFocus } from "../../packages/customer-sheet/navigation";
import { progressDateError } from "../../packages/customer-sheet/progress-dates";
import { invalidQuality, validQualityMessage } from "../../packages/customer-sheet/valid-quality";
import { recordAudit } from "./audit";
import { lockSheetAccountReferences } from "./sheet-account-references";
import { memberTemplateLabel } from "./sheet-import-template";
import { compareDatedRows, rowDate } from "../../packages/customer-sheet/date-groups";
import { groupDays } from "../../packages/customer-sheet/group-days";
import { assignActionNumbers } from "./sheet-action-numbers";
import { syncNumberStatistics } from "./number-statistics";
import { statisticsDate } from "./statistics-date";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import { isPendingCustomer } from "../../packages/customer-sheet/schema";
import { Prisma, type CustomerSheetRow } from "@prisma/client";
import { z } from "zod";
import { investmentSummary } from "../../packages/customer-sheet/investment";
import { expandMonthDay } from "../../packages/customer-sheet/month-day";
import { db } from "./db";
import { findLivePermissionUser, canReadReportGroup, type PermissionUser } from "./permissions";
import { hasAssignedRole, getAssignedRoles } from "./role-access";
import { baseColumns, legacyColumns, customerGroupStatus, customerExpertStatus, customerExpertStage, isExpertCustomer, expertStages, type Column, type SheetData } from "../../packages/customer-sheet/schema";

export class SheetError extends Error { constructor(message: string, readonly status = 400, readonly field?: string) { super(message); } }
type Tx = Prisma.TransactionClient;
const id = z.string().trim().min(1).max(128);
export const createRowsInput = z.object({ groupId: id, rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1).max(500) }).strict();
export const patchRowInput = z.object({ version: z.number().int().positive(), values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict();
export const columnInput = z.object({ groupId: id, name: z.string().trim().min(1).max(30), kind: z.enum(["text", "number", "date", "select", "boolean"]), stage: z.enum(["group", "expert"]), options: z.array(z.string().trim().min(1).max(40)).max(50).default([]) }).strict();
const frontline = (a: PermissionUser) => ["RECEPTION", "GROUP_OPERATOR", "EXPERT", "LEAD"].some(r => hasAssignedRole(a, r as "RECEPTION"));
export const isSheetManager = (a: PermissionUser) => a.role === "ADMIN" || a.role === "COMPANY_MANAGER" || ["HQ_MANAGER", "COMPANY_MANAGER", "DEPARTMENT_MANAGER"].includes(a.duty ?? "");
const manager = isSheetManager;
const historicalReceptionRoles = new Set(["RECEPTION", "LEAD"]);
const membershipRoles = (membership: { role: string; secondaryRoles: string | null }) => new Set([membership.role, ...(membership.secondaryRoles?.split(",").filter(Boolean) ?? [])]);
const historicalReceptionMembership = (membership: { role: string; secondaryRoles: string | null }) => [...membershipRoles(membership)].some(role => historicalReceptionRoles.has(role));
export async function historicalSheetOwners(tx: Tx, groupId: string) {
  const memberships = await tx.userGroupMembership.findMany({
    where: { groupId },
    select: { effectiveFrom: true, effectiveTo: true, role: true, secondaryRoles: true, user: { select: { id: true, name: true, username: true, active: true, groupId: true } } },
    orderBy: [{ effectiveFrom: "asc" }, { user: { name: "asc" } }],
  });
  const owners = new Map<string, { id: string; name: string; username: string; active: boolean; periods: { from: string; to: string | null }[] }>();
  for (const membership of memberships.filter(membership => membership.user.groupId !== groupId && historicalReceptionMembership(membership))) {
    const owner = owners.get(membership.user.id) ?? { ...membership.user, periods: [] };
    owner.periods.push({ from: membership.effectiveFrom, to: membership.effectiveTo });
    owners.set(owner.id, owner);
  }
  return [...owners.values()].map(owner => ({
    id: owner.id,
    name: owner.name,
    username: owner.username,
    label: `${owner.name}（历史成员·${owner.active ? "已调组" : "已停用"}）`,
    periods: owner.periods,
  }));
}
export async function sheetAccess(tx: Tx, actorId: string, groupId: string) {
  const actor = await findLivePermissionUser(tx, actorId);
  const group = await tx.teamGroup.findFirst({ where: { id: groupId, active: true }, include: { department: true } });
  if (!actor || !group || (!frontline(actor) && !manager(actor)) || !canReadReportGroup(actor, group)) throw new SheetError("没有权限查看该小组客户", 403);
  const lead = !manager(actor) && hasAssignedRole(actor, "LEAD") && actor.groupId === groupId;
  const canCreate = !manager(actor) && frontline(actor) && actor.groupId === groupId;
  const canChooseHistoricalOwner = lead || canCreate && hasAssignedRole(actor, "EXPERT");
  return { actor, group, lead, canCreate, canChooseHistoricalOwner, canViewGroupStatistics: lead || manager(actor), canViewFullPhone: actor.groupId === groupId };
}
export async function sheetColumns(tx: Tx, groupId: string): Promise<Column[]> {
  const rows = await tx.customerSheetColumn.findMany({ where: { groupId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return [...baseColumns, ...legacyColumns, ...rows.map(c => ({ id: c.id, name: c.name, kind: c.kind, stage: c.stage, defaultHidden: true, options: JSON.parse(c.options) as string[] }))];
}
// Full numbers are for same-group accounts; organizational read access alone does not reveal them.
export function publicPhone(phone:string,full:boolean){return full?phone:phone.length>8?`${phone.slice(0,3)}****${phone.slice(-3)}`:`${phone.slice(0,2)}****${phone.slice(-2)}`;}
function publicSheetData(data:SheetData,full:boolean):SheetData{return {...data,...(data.phone?{phone:publicPhone(String(data.phone),full)}:{}),progress:groupDays(data,statisticsDate())};}
export function assertExpertFields(actor:PermissionUser, values:SheetData, columns:Column[], expertId:unknown=values.expertId){
 if(hasAssignedRole(actor,"EXPERT")&&expertId===actor.id)return;
 const denied=columns.find(c=>c.stage==="expert"&&!["expertStatus"].includes(c.id)&&values[c.id]!==undefined&&values[c.id]!==null&&values[c.id]!=="");
 if(denied)throw new SheetError(`只有该客户指定且有专家权限的专家负责人才能填写${denied.name}`,403);
}
export function editableFields(actor: PermissionUser, row: Pick<CustomerSheetRow,"ownerId"|"data"|"groupId">, columns: Column[]) {
  if (JSON.parse(row.data).__deletedAt || manager(actor) || actor.groupId !== row.groupId || !frontline(actor)) return [];
  const data: SheetData = JSON.parse(row.data);
  const expert = data.expertId === actor.id && hasAssignedRole(actor, "EXPERT");
  if (hasAssignedRole(actor, "LEAD")) return columns.filter(c=>(c.stage!=="expert"||expert)&&!["status","expertStatus","progress"].includes(c.id)&&(c.id!=="phone"||row.ownerId===actor.id)).map(c => c.id);
  const basic = row.ownerId === actor.id;
  const group = (data.operatorId || row.ownerId) === actor.id && hasAssignedRole(actor, "GROUP_OPERATOR");
  return columns.filter(c => {
    if(["status","expertStatus","progress"].includes(c.id)) return false;
    if(c.id==="ownerId")return false;
    if(c.stage==="expert")return expert;
    if(basic)return true; // 接粉人保留接粉与群内字段，专家业务仅指定专家维护。
    if(["operatorId","expertId"].includes(c.id))return basic||group||expert;
    if (["addedExpert","expertOn"].includes(c.id)) return basic || group || expert;
    if (c.id === "nextContact") return basic || group || expert;
    return c.stage === "base" ? basic : c.stage === "group" ? group : expert;
  }).map(c => c.id);
}
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
export function validateReplyBeforeJoin(next:SheetData,previous:SheetData={}){
 if(!next.joinedOn)return;
 // Preserve legacy dates on unrelated edits; every change to this timeline must be valid.
 if(["intakeOn","replied","repliedOn","joinedOn"].every(key=>next[key]===previous[key]))return;
 if(next.replied!==true)throw new SheetError("请先勾选已回复，再填写进群日期；已进群客户不能直接取消回复，请先清空进群日期保存，再取消回复");
 if(!next.repliedOn)throw new SheetError("请先填写实际回复日期，再填写进群日期");
 if(String(next.repliedOn).slice(0,10)>String(next.joinedOn).slice(0,10))throw new SheetError(`回复日期 ${String(next.repliedOn).slice(0,10)} 不能晚于进群日期 ${String(next.joinedOn).slice(0,10)}；允许同一天，请核对实际日期`);
}
export function prepareNumberData(d:SheetData,previous:SheetData={}){
 for(const [flag,date,label] of [["replied","repliedOn","回复"],["normalLeft","normalLeftOn","正常退群"],["abnormalLeft","abnormalLeftOn","异常退群"],["addedExpert","expertOn","加专家"]]){
  if(previous[date]&&!d[date]&&(d[flag]===true||flag==="addedExpert"&&d.addedExpert!==false&&d.expertId))throw new SheetError(`已记录${label}，不能只清空${label}日期；请填写实际日期，或核对后取消相应动作`);
 }
 if(previous.firstDepositOn&&!d.firstDepositOn&&Number(d.firstDeposit)>0)throw new SheetError("已有首充金额，不能只清空首充日期；请填写实际日期，或核对后同时撤销首充金额");
 for(const [flag,date] of [["normalLeft","normalLeftOn"],["abnormalLeft","abnormalLeftOn"]]){
  if(d[flag]===true && (!d.joinedOn || d[date] && String(d[date]).slice(0,10)<String(d.joinedOn).slice(0,10)))throw new SheetError("退群必须有进群日期，退群日期不能早于进群日期；请先更正退群记录");
 }
 const dateError=progressDateError(d,previous,statisticsDate());
 if(dateError)throw new SheetError(dateError);
 if(!d.intakeOn)return;
 if(!d.channelId)throw new SheetError("按号码统计必须选择渠道");
 const today=statisticsDate();
 if(String(d.intakeOn)>today)throw new SheetError(`接粉日期 ${d.intakeOn} 不能晚于系统统计日 ${today}（北京时间14:00换日）`);
 d.quality ||= "有效";
 if(d.replied===true&&previous.replied!==true)d.repliedOn ||= today;
 if(d.repliedOn && d.replied!==false)d.replied=true;
 if(d.normalLeft===true&&previous.normalLeft!==true)d.normalLeftOn ||= today;
 if(d.abnormalLeft===true&&previous.abnormalLeft!==true)d.abnormalLeftOn ||= today;
 if(d.addedExpert===false)d.expertOn=null;
 else if(d.addedExpert===true&&previous.addedExpert!==true||d.expertId&&d.expertId!==previous.expertId)d.expertOn ||= today;
 if(Number(d.firstDeposit)>0){if(!Number(previous.firstDeposit))d.firstDepositOn ||= d.orderedOn||today;d.firstDepositMethod ||= "银行卡";}
 const preparedError=progressDateError(d,previous,today);
 if(preparedError)throw new SheetError(preparedError);
}
export async function normalize(tx: Tx, groupId: string, raw: SheetData, columns: Column[], previous: SheetData = {}): Promise<SheetData> {
  const data: SheetData = {};
  if(invalidQuality(raw.quality))throw new SheetError(validQualityMessage);
  for (const [key, value] of Object.entries(raw)) {
    if(key==="progress")continue; // Legacy imports cannot override calculated days.
    const c = columns.find(c => c.id === key);
    if (!c) throw new SheetError(`未知字段：${key}`);
    if (value === null || value === "") { data[key] = null; continue; }
    if (c.kind === "number" || c.kind === "money") {
      const n = typeof value === "number" ? value : Number(String(value).replace(/,/g,""));
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new SheetError(`${c.name}必须是有效数字`);
      if (c.kind === "money" && (n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001)) throw new SheetError(`${c.name}请填写非负金额，最多两位小数`);
      if (key === "progress" && (n < 0 || !Number.isInteger(n))) throw new SheetError("进度请填写非负整数");
      data[key] = n;
    } else if (c.kind === "boolean") {
      if (![true,false,"是","否","true","false","1","0","✓"].includes(value as string | boolean)) throw new SheetError(`${c.name}请填写是或否`);
      data[key] = [true,"是","true","1","✓"].includes(value as string | boolean);
    } else {
      let text = String(value).trim();
      if (c.kind === "date" || c.kind === "datetime") text = expandMonthDay(text, previous[key]).replace(/\//g,"-");
      if (c.kind === "datetime") {
        text = text.replace(/\//g,"-").replace(" ","T");
        if (!validDate(text) && !(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text) && validDate(text.slice(0,10)) && Number(text.slice(11,13))<24 && Number(text.slice(14,16))<60 && (!text.slice(17)||Number(text.slice(17))<60))) throw new SheetError(`${c.name}请填写有效月日，例如09/11`);
      }
      if (text.length > 4000) throw new SheetError(`${c.name}不能超过4000字`);
      if (c.kind === "date" && !validDate(text)) throw new SheetError(`${c.name}请填写有效月日，例如09/11`);
      if (c.kind === "select" && !c.options?.includes(text)) throw new SheetError(`${c.name}不在可选项中`);
      data[key] = text;
    }
  }
  if (data.normalLeft === true && data.abnormalLeft === true) throw new SheetError("正常退群和异常退群不能同时勾选");
  if (data.normalLeft === true) data.abnormalLeft = false;
  if (data.abnormalLeft === true) data.normalLeft = false;
  if ("phone" in data) {
    const phone = String(data.phone ?? "").replace(/[\s()+-]/g, "");
    if (!/^\d{6,20}$/.test(phone)) throw new SheetError("客户号码需为6至20位数字");
    data.phone = phone;
  }
  for (const key of ["ownerId", "operatorId", "expertId"]) {
    if (!data[key]) continue;
    const selected=String(data[key]);
    const account=selected.match(/（账号：([^）]+)）$/)?.[1];
    const candidates = await tx.user.findMany({ where: { groupId, active: true, OR: [{ id: selected }, { name: selected }, ...(account?[{username:account}]:[])] }, include: { roleAssignments: true } });
    const exact=candidates.find(p=>p.id===selected || memberTemplateLabel(p)===selected);
    const names=candidates.filter(p=>p.name===selected);
    if(!exact && names.length>1)throw new SheetError(`${columns.find(c=>c.id===key)?.name}有同名人员，请使用新版模板下拉选择带账号的人员`);
    let person=exact || names[0];
    let historicalOwner = false;
    if (!person && key === "ownerId") {
      const historicalCandidates = await tx.user.findMany({
        where: { OR: [{ id: selected }, { name: selected }, ...(account ? [{ username: account }] : [])], membershipHistory: { some: { groupId } } },
        include: { roleAssignments: true, membershipHistory: { where: { groupId }, orderBy: { effectiveFrom: "asc" } } },
      });
      const historicalExact = historicalCandidates.find(candidate => candidate.id === selected || memberTemplateLabel(candidate) === selected);
      const historicalNames = historicalCandidates.filter(candidate => candidate.name === selected);
      if (!historicalExact && historicalNames.length > 1) throw new SheetError(`${columns.find(c=>c.id===key)?.name}有同名历史成员，请从下拉名单选择`);
      const historical = historicalExact || historicalNames[0];
      const intakeOn = String(raw.intakeOn || previous.intakeOn || "").slice(0, 10);
      const validMembership = historical?.membershipHistory.find(membership => historicalReceptionMembership(membership)
        && (!intakeOn || membership.effectiveFrom <= intakeOn && (!membership.effectiveTo || membership.effectiveTo >= intakeOn)));
      if (historical && !validMembership) throw new SheetError(intakeOn
        ? `接粉负责人在接粉日期 ${intakeOn} 不属于本组，请核对真实接粉日期`
        : "历史接粉负责人必须曾在本组担任业务岗位");
      person = historical;
      historicalOwner = Boolean(historical);
    }
    const role = key === "expertId" ? "EXPERT" : key === "operatorId" ? "GROUP_OPERATOR" : "RECEPTION";
    if (!person || (key === "ownerId" ? !historicalOwner && !frontline(person) : !hasAssignedRole(person, role) && (key === "expertId" || !hasAssignedRole(person, "LEAD")))) throw new SheetError(`${columns.find(c=>c.id===key)?.name}必须是本组对应岗位的在职人员`);
    data[key] = person.id;
  }
  if (data.channelId) {
    if(previous.__statisticsGroupId && previous.__statisticsGroupId!==groupId){
      if(data.channelId!==previous.channelId)throw new SheetError("跨组客户保留原来源渠道，不能改到新组渠道");
      return data;
    }
    const channel = await tx.channel.findFirst({ where: { groupId, active: true, OR: [{ id: String(data.channelId) }, { name: String(data.channelId) }] } });
    if (!channel) {
      const inactive = await tx.channel.findFirst({ where: { groupId, active: false, OR: [{ id: String(data.channelId) }, { name: String(data.channelId) }] } });
      throw new SheetError(`渠道“${String(data.channelId).slice(0,80)}”${inactive ? "在本组已停用" : "未匹配本组启用渠道"}，请核对名称或重新选择本组启用渠道`,400,"channelId");
    }
    data.channelId = channel.id;
  }
  return data;
}
export async function createSheetRows(actorId: string, raw: unknown) {
  const input = createRowsInput.parse(raw);
  return db.$transaction(tx=>createSheetRowsInTransaction(tx,actorId,input),{timeout:30000});
}
export async function createSheetRowsInTransaction(tx:Tx,actorId:string,input:z.infer<typeof createRowsInput>,sync=true) {
    await lockSheetAccountReferences(tx);
    const access = await sheetAccess(tx, actorId, input.groupId);
    if (!access.canCreate) throw new SheetError("该账号只能查看客户",403);
    const columns = await sheetColumns(tx,input.groupId);
    const result = [];
    for (let i=0; i<input.rows.length; i++) {
      let values;
      try { values = await normalize(tx, input.groupId, input.rows[i], columns); }
      catch(e) { if(e instanceof SheetError) throw new SheetError(`第${i+1}行：${e.message}`); throw e; }
      if (!values.phone) throw new SheetError(`第${i+1}行：客户号码必填`);
      values.quality ||= "有效";
      assertExpertFields(access.actor,values,columns);
      prepareNumberData(values);
      validateReplyBeforeJoin(values);
      values.status = customerGroupStatus(values);
      values.ownerId ||= actorId;
      if(!("operatorId" in values) && values.ownerId===actorId && hasAssignedRole(access.actor,"GROUP_OPERATOR"))values.operatorId=actorId;
      // 导入可以含任意阶段的已有信息，但普通成员不能借导入创建别人的记录。
      const assignedExpertCreatesOldCustomer = values.expertId === actorId && hasAssignedRole(access.actor,"EXPERT") && Boolean(values.expertOn);
      if (!access.lead && values.ownerId !== actorId && !assignedExpertCreatesOldCustomer) throw new SheetError(`第${i+1}行：只有组长或当前专家负责人可以选择其他接粉归属`,403);
      if (await tx.customerSheetRow.findUnique({ where: { groupId_phone: { groupId: input.groupId, phone: String(values.phone) } } })) throw new SheetError(`第${i+1}行：本组已存在该号码，请在原行修改；若已删除，请先到已删除列表恢复`,409);
      await assignActionNumbers(tx,input.groupId,values);
      const row = await tx.customerSheetRow.create({ data: { groupId: input.groupId, phone: String(values.phone), ownerId: String(values.ownerId), data: JSON.stringify(values) } });
      await tx.customerSheetRevision.create({ data: { rowId:row.id, version:1, actorId, before:"{}", after:row.data } });
      result.push(row.id);
    }
    if(sync)await syncNumberStatistics(tx,input.groupId,actorId);
    return result;
}
export async function patchSheetRowInTransaction(tx: Tx, actorId: string, rowId: string, raw: unknown, sync=true) {
  await lockSheetAccountReferences(tx);
  const input = patchRowInput.parse(raw);
    const row = await tx.customerSheetRow.findUnique({where:{id:rowId}});
    if (!row) throw new SheetError("客户不存在",404);
    if(JSON.parse(row.data).__deletedAt)throw new SheetError("客户已删除，请先恢复",409);
    const access = await sheetAccess(tx,actorId,row.groupId);
    const columns = await sheetColumns(tx,row.groupId);
    const allowed = editableFields(access.actor,row,columns);
    if (!Object.keys(input.values).length || Object.keys(input.values).some(k=>!allowed.includes(k))) throw new SheetError("只能修改本人负责的内容，其他人的内容只读",403);
    const values = await normalize(tx,row.groupId,input.values,columns,JSON.parse(row.data));
    if (("phone" in values && !values.phone) || ("ownerId" in values && !values.ownerId)) throw new SheetError("号码和接粉归属不能为空");
    const merged = {...JSON.parse(row.data),...values};
    assertExpertFields(access.actor,values,columns,merged.expertId);
    if(values.addedExpert===false){
      if(merged.submitted===true||merged.traceStartedOn||merged.invitedOn||merged.registeredOn||Number(merged.firstDeposit)>0||investmentSummary(merged).entries.length)throw new SheetError("已有专家后续记录或资金，不能直接取消已加专家；请先核对并更正后续记录");
      merged.expertOn=null;
    }
    if(!("operatorId" in merged) && row.ownerId===actorId && hasAssignedRole(access.actor,"GROUP_OPERATOR"))merged.operatorId=actorId;
    if ("firstDeposit" in values || "investmentTotal" in values) {
      const previous=investmentSummary(JSON.parse(row.data));
      if ("investmentTotal" in values && previous.entries.length) throw new SheetError("已有续充明细，投资总额由首充和续充自动合计");
      merged.__investmentBaseCents="investmentTotal" in values?Math.max(0,Math.round(Number(values.investmentTotal||0)*100)-Math.round(Number(merged.firstDeposit||0)*100)):previous.baseCents;
      merged.investmentTotal=investmentSummary(merged).totalCents/100;
    }
    prepareNumberData(merged,JSON.parse(row.data));
    validateReplyBeforeJoin(merged,JSON.parse(row.data));
    merged.status = customerGroupStatus(merged);
    await assignActionNumbers(tx,sheetStatisticsGroup(row.groupId,merged),merged);
    const data = JSON.stringify(merged);
    const updated = await tx.customerSheetRow.updateMany({ where:{id:rowId,version:input.version}, data:{data,phone:String(values.phone ?? row.phone),ownerId:String(values.ownerId ?? row.ownerId),version:{increment:1}} });
    if (!updated.count) throw new SheetError("这行已被其他人修改，请刷新后重试",409);
    await tx.customerSheetRevision.create({data:{rowId,version:input.version+1,actorId,before:row.data,after:data}});
    if(sync)await syncNumberStatistics(tx,row.groupId,actorId);
    return {version:input.version+1, data:publicSheetData(JSON.parse(data),access.canViewFullPhone), phone:publicPhone(String(values.phone ?? row.phone),access.canViewFullPhone), ownerId:String(values.ownerId ?? row.ownerId), editable:editableFields(access.actor,{...row,data,ownerId:String(values.ownerId ?? row.ownerId)},columns)};
}
export async function patchSheetRow(actorId: string, rowId: string, raw: unknown) {
  return db.$transaction(tx => patchSheetRowInTransaction(tx, actorId, rowId, raw));
}
export async function addSheetRechargeInTransaction(tx:Tx,actorId:string,rowId:string,raw:unknown,sync=true){
 await lockSheetAccountReferences(tx);
 const input=z.object({version:z.number().int().positive(),requestId:z.string().uuid(),amount:z.number().positive().max(1e10),date:z.string(),method:z.enum(["bank","crypto"]),kind:z.enum(["recharge","withdrawal"]).default("recharge"),replace:z.boolean().default(false)}).strict().parse(raw);
 if(Math.abs(input.amount*100-Math.round(input.amount*100))>0.0001)throw new SheetError("续充金额最多两位小数");
 if(!validDate(input.date))throw new SheetError("请选择有效续充日期");
  const row=await tx.customerSheetRow.findUnique({where:{id:rowId}});if(!row)throw new SheetError("客户不存在",404);
  if(JSON.parse(row.data).__deletedAt)throw new SheetError("客户已删除，请先恢复",409);
  const access=await sheetAccess(tx,actorId,row.groupId);
  const columns=await sheetColumns(tx,row.groupId);
  if(!editableFields(access.actor,row,columns).includes("investmentTotal"))throw new SheetError("只能为本人负责的客户添加续充",403);
  const d:SheetData=JSON.parse(row.data);const summary=investmentSummary(d);
  const existing=summary.entries.find(r=>r.id===input.requestId);
  if(existing){
   const same=existing.amountCents===Math.round(input.amount*100)&&existing.date===input.date&&existing.method===input.method&&(existing.kind??"recharge")===input.kind;
   if(same)return {version:row.version,data:publicSheetData(d,access.canViewFullPhone)};
   if(!input.replace)throw new SheetError("同一次提交的内容不一致，请重新打开弹窗",409);
  }else if(input.replace)throw new SheetError("资金记录不存在",404);
  if(!existing&&summary.entries.length>=1000)throw new SheetError("该客户资金记录已达上限");
  d.__investmentBaseCents=summary.baseCents;
  const nextEntry={id:input.requestId,amountCents:Math.round(input.amount*100),date:input.date,method:input.method,kind:input.kind,actorId,createdAt:new Date().toISOString()};
  d.__recharges=JSON.stringify(existing?summary.entries.map(r=>r.id===input.requestId?nextEntry:r):[...summary.entries,nextEntry]);
  d.investmentTotal=investmentSummary(d).totalCents/100;
  prepareNumberData(d,JSON.parse(row.data));
  await assignActionNumbers(tx,sheetStatisticsGroup(row.groupId,d),d);
  const updated=await tx.customerSheetRow.updateMany({where:{id:rowId,version:input.version},data:{data:JSON.stringify(d),version:{increment:1}}});
  if(!updated.count)throw new SheetError("客户已被修改，请关闭弹窗刷新后重试",409);
  await tx.customerSheetRevision.create({data:{rowId,version:input.version+1,actorId,before:row.data,after:JSON.stringify(d)}});
  if(sync)await syncNumberStatistics(tx,row.groupId,actorId);
  return {version:input.version+1,data:publicSheetData(d,access.canViewFullPhone)};
}
export async function addSheetRecharge(actorId:string,rowId:string,raw:unknown){
 return db.$transaction(tx=>addSheetRechargeInTransaction(tx,actorId,rowId,raw));
}
export async function deleteSheetRecharge(actorId:string,rowId:string,raw:unknown){
 return db.$transaction(async tx=>{
  await lockSheetAccountReferences(tx);
  const input=z.object({version:z.number().int().positive(),requestId:z.string().uuid()}).strict().parse(raw);
  const row=await tx.customerSheetRow.findUnique({where:{id:rowId}});if(!row)throw new SheetError("客户不存在",404);
  if(JSON.parse(row.data).__deletedAt)throw new SheetError("客户已删除，请先恢复",409);
  const access=await sheetAccess(tx,actorId,row.groupId);
  const columns=await sheetColumns(tx,row.groupId);
  if(!editableFields(access.actor,row,columns).includes("investmentTotal"))throw new SheetError("只能删除本人负责客户的资金流水",403);
  const previous:SheetData=JSON.parse(row.data);const summary=investmentSummary(previous);
  if(!summary.entries.some(r=>r.id===input.requestId))throw new SheetError("资金流水不存在，请刷新后重试",404);
  const d:SheetData={...previous,__investmentBaseCents:summary.baseCents,__recharges:JSON.stringify(summary.entries.filter(r=>r.id!==input.requestId))};
  d.investmentTotal=investmentSummary(d).totalCents/100;
  prepareNumberData(d,previous);
  await assignActionNumbers(tx,sheetStatisticsGroup(row.groupId,d),d);
  const updated=await tx.customerSheetRow.updateMany({where:{id:rowId,version:input.version},data:{data:JSON.stringify(d),version:{increment:1}}});
  if(!updated.count)throw new SheetError("客户已被修改，请关闭弹窗刷新后重试",409);
  await tx.customerSheetRevision.create({data:{rowId,version:input.version+1,actorId,before:row.data,after:JSON.stringify(d)}});
  await syncNumberStatistics(tx,row.groupId,actorId);
  return {version:input.version+1,data:publicSheetData(d,access.canViewFullPhone)};
 });
}
export async function patchSheetRows(actorId: string, raw: unknown) {
  const input = z.object({ rows: z.array(patchRowInput.extend({ id })).min(1).max(50) }).strict().parse(raw);
  if (new Set(input.rows.map(row => row.id)).size !== input.rows.length) throw new SheetError("同一客户不能重复提交");
  return db.$transaction(async tx => {
    const results = [];
    for (const { id: rowId, ...patch } of input.rows) results.push(await patchSheetRowInTransaction(tx, actorId, rowId, patch));
    return { updated: results.length };
  }, { timeout: 30000 });
}
export async function listSheet(actorId:string,params:URLSearchParams) {
  const groupId = params.get("groupId") ?? "";
  return db.$transaction(async tx=>{
    const access=await sheetAccess(tx,actorId,groupId);
    const columns=await sheetColumns(tx,groupId);
    const all=await tx.customerSheetRow.findMany({where:{groupId},orderBy:[{createdAt:"desc"},{id:"asc"}]});
    const targetId = params.get("focusId");
    let focus: CustomerFocus | undefined;
    if (targetId) {
      const target = all.find(row => row.id === targetId);
      if (!target) throw new SheetError("该客户已不存在或不在当前小组，请重新找号码",404);
      const data: SheetData = JSON.parse(target.data);
      focus = { id: target.id, ownerId: target.ownerId, stage: customerStage(data), deleted: Boolean(data.__deletedAt), date: rowDate(data, data.__deletedAt ? null : customerStage(data)) };
      // Resolve by stable customer ID on every request, independent of stale page/filter values.
      params = new URLSearchParams({ groupId, responsibility: "owner", assignee: target.ownerId, stage: focus.stage, deleted: focus.deleted ? "1" : "0" });
    }
    const query=(params.get("q")??"").trim().slice(0,100).toLowerCase();
    const phoneQuery=normalizeCustomerQuery(query);
    const trash=params.get("deleted")==="1";
    const stage=trash?null:params.get("stage");
    const responsibility=params.get("responsibility");
    const selected=params.get("assignee");
    const assignee=selected==="me"?actorId:selected;
    if(responsibility&&!['owner','operator','expert'].includes(responsibility))throw new SheetError("负责人类型无效");
    const scoped=all.filter(r=>{
      const d:SheetData=JSON.parse(r.data);
      if(!inCustomerView(d,stage,trash))return false;
      // Search and full-number display share the existing authorized group scope.
      return (!query || (/^\d{4}$/.test(phoneQuery) && r.phone.endsWith(phoneQuery)) || (access.canViewFullPhone && /^\d{6,20}$/.test(phoneQuery) && r.phone===phoneQuery) || Object.values(publicSheetData(d,access.canViewFullPhone)).some(v=>String(v??"").toLowerCase().includes(query)))
        && (params.get("mine")!=="1" || (trash?canManageSheetRow(access.actor,r):editableFields(access.actor,r,columns).length>0))
        && (!responsibility || !assignee || assignee==="all" || (responsibility==="owner"?r.ownerId:responsibility==="operator"?d.operatorId:d.expertId)===assignee);
    });
    const from=trash?"":params.get("dateFrom")||"", to=trash?"":params.get("dateTo")||"";
    if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to))throw new SheetError("请选择有效的日期范围");
    const dated=scoped.filter(r=>{const date=rowDate(JSON.parse(r.data),stage);return (!from||date>=from)&&(!to||(!!date&&date<=to));});
    const expertCounts: Record<string,number> = Object.fromEntries(expertStages.map(s=>[s,0]));
    for(const r of dated){const d=JSON.parse(r.data);if(isExpertCustomer(d)){expertCounts[expertStages[0]]++;const bucket=customerExpertStage(d);if(bucket)expertCounts[bucket]++;}}
    const filtered=dated.filter(r=>{const d=JSON.parse(r.data);return trash || (!params.get("status") || (stage==="expert"?customerExpertStatus(d):customerGroupStatus(d))===params.get("status")) && (stage!=="expert"||!params.get("expertStage")||params.get("expertStage")===expertStages[0]||customerExpertStage(d)===params.get("expertStage"));});
    filtered.sort((a,b)=>compareDatedRows({id:a.id,data:JSON.parse(a.data)},{id:b.id,data:JSON.parse(b.data)},stage));
    const dateCounts:Record<string,number>={};
    for(const r of filtered){const date=rowDate(JSON.parse(r.data),stage);dateCounts[date]=(dateCounts[date]||0)+1;}
    const page=focus ? Math.floor(filtered.findIndex(row=>row.id===focus.id)/customerPageSize)+1 : Math.max(1,Math.min(Math.floor(Number(params.get("page"))||1),Math.max(1,Math.ceil(filtered.length/customerPageSize))));
    const [members,channels,historicalOwners]=await Promise.all([
      tx.user.findMany({where:{groupId,active:true},select:{id:true,name:true,role:true,active:true,groupId:true,roleAssignments:true},orderBy:{name:"asc"}}),
      tx.channel.findMany({where:{groupId,active:true},select:{id:true,name:true},orderBy:{name:"asc"}}),
      access.canChooseHistoricalOwner ? historicalSheetOwners(tx,groupId) : Promise.resolve([]),
    ]);
    const references=all.map(r=>JSON.parse(r.data) as SheetData);
    const memberIds=[...new Set(all.flatMap((r,i)=>[r.ownerId,references[i].operatorId,references[i].expertId]).filter((id):id is string=>typeof id==="string"&&Boolean(id)))];
    const channelIds=[...new Set(references.map(d=>d.channelId).filter((id):id is string=>typeof id==="string"&&Boolean(id)))];
    const [referenceMembers,referenceChannels]=await Promise.all([tx.user.findMany({where:{id:{in:memberIds}},select:{id:true,name:true}}),tx.channel.findMany({where:{id:{in:channelIds}},select:{id:true,name:true}})]);
    const referenceNames=Object.fromEntries([...referenceMembers,...referenceChannels].map(r=>[r.id,r.name]));
    return {actorId,groupId,groupName:access.group.name,focus,today:statisticsDate(),canCreate:access.canCreate,canConfigure:access.lead,canChooseHistoricalOwner:access.canChooseHistoricalOwner,dateCounts,expertCounts,columns,members:members.filter(frontline).map(m=>({id:m.id,name:m.name,roles:getAssignedRoles(m)})),historicalOwners,channels,referenceNames,
      rows:filtered.slice((page-1)*customerPageSize,page*customerPageSize).map(r=>({...r,phone:publicPhone(r.phone,access.canViewFullPhone),data:{...publicSheetData(JSON.parse(r.data),access.canViewFullPhone),status:customerGroupStatus(JSON.parse(r.data))} as SheetData,canManage:canManageSheetRow(access.actor,r),editable:editableFields(access.actor,r,columns)})),total:filtered.length,page,pages:Math.max(1,Math.ceil(filtered.length/customerPageSize))};
  });
}
export async function createSheetColumn(actorId:string,raw:unknown) {
  const input=columnInput.parse(raw);
  if(baseColumns.some(c=>c.name===input.name)) throw new SheetError("与核心字段重名");
  if(input.kind==="select" && !input.options.length) throw new SheetError("下拉列至少提供一个选项");
  return db.$transaction(async tx=>{
    const access=await sheetAccess(tx,actorId,input.groupId);
    if(!access.lead) throw new SheetError("只有本组组长可以配置列",403);
    const count=await tx.customerSheetColumn.count({where:{groupId:input.groupId}});
    if(count>=30) throw new SheetError("每组最多30个自定义列");
    return tx.customerSheetColumn.create({data:{...input,options:JSON.stringify([...new Set(input.options)]),sortOrder:count}});
  });
}
export async function sheetHistory(actorId:string,rowId:string) {
  return db.$transaction(async tx=>{
  const row=await tx.customerSheetRow.findUnique({where:{id:rowId}});
    if(!row) throw new SheetError("客户不存在",404);
    const access=await sheetAccess(tx,actorId,row.groupId);
    const history=await tx.customerSheetRevision.findMany({where:{rowId},orderBy:{version:"desc"},include:{actor:{select:{name:true}}},take:100});
    return history.map(h=>({...h,before:JSON.stringify(publicSheetData(JSON.parse(h.before),access.canViewFullPhone)),after:JSON.stringify(publicSheetData(JSON.parse(h.after),access.canViewFullPhone))}));
  });
}

/** Entire-customer operations belong to the current stage owner or the group lead. */
export function canManageSheetRow(actor:PermissionUser,row:Pick<CustomerSheetRow,"groupId"|"ownerId"|"data">){
 if(manager(actor)||actor.groupId!==row.groupId||!frontline(actor))return false;
 if(hasAssignedRole(actor,"LEAD")||row.ownerId===actor.id)return true;
 const d:SheetData=JSON.parse(row.data);
 if(isExpertCustomer(d))return d.expertId===actor.id&&hasAssignedRole(actor,"EXPERT");
 if(d.joinedOn)return (d.operatorId||row.ownerId)===actor.id&&hasAssignedRole(actor,"GROUP_OPERATOR");
 return row.ownerId===actor.id;
}
export async function changeSheetRowDeletion(actorId:string,rowId:string,raw:unknown){
 const input=z.object({version:z.number().int().positive(),deleted:z.boolean()}).strict().parse(raw);
 return db.$transaction(async tx=>{
  await lockSheetAccountReferences(tx);
  const row=await tx.customerSheetRow.findUnique({where:{id:rowId}});
  if(!row)throw new SheetError("客户不存在",404);
  const access=await sheetAccess(tx,actorId,row.groupId);
  if(!canManageSheetRow(access.actor,row))throw new SheetError("只有本组组长、接粉负责人或客户当前阶段负责人可以删除、恢复",403);
  if(row.version!==input.version)throw new SheetError("这行已被其他人修改，请刷新后重试",409);
  const d:SheetData=JSON.parse(row.data);
  if(Boolean(d.__deletedAt)===input.deleted)throw new SheetError("客户状态已变化，请刷新后重试",409);
  if(input.deleted){d.__deletedAt=new Date().toISOString();d.__deletedBy=actorId;}
  else{delete d.__deletedAt;delete d.__deletedBy;}
  const after=JSON.stringify(d);
  const result=await tx.customerSheetRow.updateMany({where:{id:rowId,version:input.version},data:{data:after,version:{increment:1}}});
  if(!result.count)throw new SheetError("这行已被其他人修改，请刷新后重试",409);
  await tx.customerSheetRevision.create({data:{rowId,version:input.version+1,actorId,before:row.data,after}});
  await recordAudit(tx,{actorId,action:input.deleted?"CUSTOMER_SHEET_DELETE":"CUSTOMER_SHEET_RESTORE",entityType:"CustomerSheetRow",entityId:rowId,summary:{groupId:row.groupId,version:input.version+1}});
  await syncNumberStatistics(tx,row.groupId,actorId);
  return {version:input.version+1};
 },{timeout:30000});
}

/** Explicitly selected permanent deletion; available for live and archived customers.
 * The version claim locks the row before deleting revisions, so a concurrent edit or
 * restore cannot be silently discarded. Everything, including the rebuild, rolls back. */
export async function permanentlyDeleteSheetRow(actorId:string,rowId:string,raw:unknown){
 const input=z.object({version:z.number().int().positive(),action:z.literal("permanent")}).strict().parse(raw);
 return db.$transaction(async tx=>{
  await lockSheetAccountReferences(tx);
  const row=await tx.customerSheetRow.findUnique({where:{id:rowId}});
  if(!row)throw new SheetError("客户不存在或已永久删除",404);
  const access=await sheetAccess(tx,actorId,row.groupId);
  if(!canManageSheetRow(access.actor,row))throw new SheetError("只有本组组长、接粉负责人或客户当前阶段负责人可以永久删除",403);
  const claimed=await tx.customerSheetRow.updateMany({where:{id:rowId,version:input.version},data:{version:{increment:1}}});
  if(!claimed.count)throw new SheetError("客户已被修改，请刷新后重新选择删除",409);
  const sourceGroupId=sheetStatisticsGroup(row.groupId,JSON.parse(row.data));
  await tx.customerSheetRevision.deleteMany({where:{rowId}});
  await tx.customerSheetRow.delete({where:{id:rowId}});
  await recordAudit(tx,{actorId,action:"CUSTOMER_SHEET_PERMANENT_DELETE",entityType:"CustomerSheetRow",entityId:rowId,summary:{groupId:row.groupId,sourceGroupId,version:input.version}});
  await syncNumberStatistics(tx,row.groupId,actorId,[sourceGroupId]);
  return {deleted:true,permanent:true};
 },{timeout:30000});
}
