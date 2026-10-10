export type CellValue = string | number | boolean | null;
export type SheetData = Record<string, CellValue>;
export type Column = { id: string; name: string; kind: string; stage: string; options?: string[]; hidden?: boolean; defaultHidden?: boolean };
export const baseColumns: Column[] = [
  {id:"intakeOn",name:"接粉日期",kind:"date",stage:"base"},
  {id:"quality",name:"号码情况",kind:"select",stage:"base",options:["有效"]},
  {id:"replied",name:"是否回复",kind:"boolean",stage:"base"},
  {id:"repliedOn",name:"回复日期",kind:"date",stage:"base"},
  {id:"firstDepositOn",name:"首充 / 开单日期",kind:"date",stage:"expert"},
  {id:"firstDepositMethod",name:"首充方式",kind:"select",stage:"expert",options:["银行卡","加密货币"]},
  { id: "expertStatus", name: "专家状态", kind: "text", stage: "expert" },
  { id: "expertMode", name: "跟进安排", kind: "select", stage: "expert", options: ["自动跟进", "暂停跟进", "已结束"] },
  { id: "status", name: "状态", kind: "select", stage: "base", options: ["待跟进", "正常在群", "已推专家", "已注册", "已开单", "正常退群", "异常退群", "暂停跟进"] },
  { id: "phone", name: "客户号码", kind: "text", stage: "base" },
  { id: "progress", name: "在群第几天", kind: "number", stage: "group" },
  { id: "ownerId", name: "前台", kind: "member", stage: "base" },
  { id: "operatorId", name: "群操作员", kind: "member", stage: "base" },
  { id: "channelId", name: "渠道", kind: "channel", stage: "base" },
  { id: "lossAmount", name: "损失金额", kind: "money", stage: "group" },
  { id: "note", name: "客户情况备注", kind: "text", stage: "group" },
  { id: "addedExpert", name: "已加专家", kind: "boolean", stage: "group" },
  { id: "expertOn", name: "已加专家日期", kind: "datetime", stage: "group" },
  { id: "submitted", name: "提交资料", kind: "boolean", stage: "expert" },
  { id: "traceStartedOn", name: "追踪开始", kind: "datetime", stage: "expert" },
  { id: "invitedOn", name: "邀请注册", kind: "datetime", stage: "expert" },
  { id: "accurateAmount", name: "准确金额", kind: "money", stage: "expert" },
  { id: "registeredOn", name: "已经开户", kind: "datetime", stage: "expert" },
  { id: "customerProgress", name: "客户进展", kind: "text", stage: "expert" },
  { id: "expertNote", name: "客户情况跟进并备注", kind: "text", stage: "expert" },
  { id: "investmentTotal", name: "投资总额", kind: "money", stage: "expert" },
  { id: "firstDeposit", name: "首充", kind: "money", stage: "expert" },
  { id: "device", name: "设备号码", kind: "text", stage: "group" },
  { id: "joinedOn", name: "进群日期", kind: "datetime", stage: "group" },
  { id: "normalLeft", name: "正常退群", kind: "boolean", stage: "group" },
  { id: "normalLeftOn", name: "正常退群日期", kind: "datetime", stage: "group" },
  { id: "abnormalLeft", name: "异常退群", kind: "boolean", stage: "group" },
  { id: "abnormalLeftOn", name: "异常退群日期", kind: "datetime", stage: "group" },
  { id: "expertId", name: "专家负责人", kind: "member", stage: "base" },
];
// Preserve stored values and assignment permissions without showing retired columns.
export const legacyColumns: Column[] = [
  { id: "name", name: "客户姓名", kind: "text", stage: "base", hidden: true },
  { id: "orderedOn", name: "开单日期", kind: "date", stage: "expert", hidden: true },
  { id: "nextContact", name: "下次联系", kind: "date", stage: "base", hidden: true },
];
export const groupViewColumnIds = ["intakeOn","quality","replied","repliedOn","status", "phone", "progress", "ownerId", "operatorId", "channelId", "device", "lossAmount", "joinedOn", "normalLeft", "normalLeftOn", "abnormalLeft", "abnormalLeftOn", "note", "addedExpert", "expertId"];
export function isPendingCustomer(d: SheetData): boolean {
  return !d.joinedOn && d.normalLeft !== true && d.abnormalLeft !== true && !isExpertCustomer(d);
}
export const pendingColumnIds = ["intakeOn","quality","replied","repliedOn","phone", "ownerId", "operatorId", "channelId", "device", "note", "joinedOn"];
export function viewColumns(columns: Column[], view: string): Column[] {
  const visible = columns.filter(c => !c.hidden);
  if (view === "pending") return pendingColumnIds.flatMap(id => visible.filter(c => c.id === id));
  if (view !== "group") return [...["expertStatus","phone","expertMode"].flatMap(id=>visible.filter(c=>c.id===id)), ...visible.filter(c=>!["status","expertStatus","expertMode","phone"].includes(c.id))];
  return [...groupViewColumnIds.flatMap(id => visible.filter(c => c.id === id)), ...visible.filter(c => c.defaultHidden && c.stage === "group")];
}
export type SheetRow = { id: string; phone: string; ownerId: string; data: SheetData; version: number; updatedAt: string; editable: string[]; canManage?: boolean };
export type SheetPayload = {
  actorId: string; groupId: string; groupName: string; today?: string; canCreate: boolean; canConfigure: boolean; canChooseHistoricalOwner?: boolean;
  members: { id: string; name: string; roles: string[] }[]; channels: { id: string; name: string }[];
  historicalOwners?: { id: string; name: string; label: string; periods: { from: string; to: string | null }[] }[];
  referenceNames?: Record<string,string>;
  columns: Column[]; rows: SheetRow[]; total: number; page: number; pages: number;
  dateCounts?: Record<string, number>;
  expertCounts?: Record<string, number>;
  focus?: import("./navigation").CustomerFocus;
};

export function customerGroupStatus(data: SheetData): string {
  return data.abnormalLeft === true ? "异常退群" : data.normalLeft === true ? "正常退群" : data.joinedOn ? "正常在群" : "待跟进";
}
export const expertStages = ["全部", "联系", "追踪", "注册", "开单", "暂停跟进", "已结束"];
export const expertStatuses = ["待加专家", "待提交资料", "待开始追踪", "追踪中", "已邀请注册", "已开户", "已首充", "暂停跟进", "已结束"];
export function customerExpertStatus(d: SheetData): string {
 if(d.expertMode==="暂停跟进"||d.expertMode==="已结束")return d.expertMode;
 if(Number(d.firstDeposit)>0)return "已首充";
 if(d.registeredOn)return "已开户";
 if(d.invitedOn)return "已邀请注册";
 if(d.traceStartedOn)return "追踪中";
 if(d.submitted===true)return "待开始追踪";
 if(d.addedExpert!==false&&(d.addedExpert===true||d.expertOn))return "待提交资料";
 return "待加专家";
}
export function customerExpertStage(d: SheetData): string {
 const status=customerExpertStatus(d);
 if(["暂停跟进","已结束"].includes(status))return status;
 if(status==="已首充")return "开单";
 if(["已开户","已邀请注册"].includes(status))return "注册";
 return status==="追踪中"?"追踪":"联系";
}
export function isExpertCustomer(d: SheetData): boolean {
 return Boolean(d.expertId||d.addedExpert||d.expertOn||d.submitted||d.traceStartedOn||d.invitedOn||d.registeredOn||Number(d.firstDeposit)>0||d.customerProgress||d.orderedOn||d.expertMode||["已推专家","已注册","已开单"].includes(String(d.status)));
}
