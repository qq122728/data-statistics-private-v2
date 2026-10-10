export type FieldGroup={name:string;ids:string[]};
export function sheetLayout(view:string,stage:string):FieldGroup[]{
 if(view==="pending")return [{name:"接粉",ids:["intakeOn","quality"]},{name:"回复",ids:["replied","repliedOn"]},{name:"号码",ids:["phone"]},{name:"负责人",ids:["ownerId","operatorId"]},{name:"来源",ids:["channelId","device"]},{name:"跟进备注",ids:["note"]},{name:"确认进群",ids:["joinedOn"]}];
 if(view==="group")return [
  {name:"接粉情况",ids:["intakeOn","quality"]},
  {name:"回复",ids:["replied","repliedOn"]},
  {name:"客户",ids:["status","phone"]},
  {name:"负责人",ids:["ownerId","operatorId","expertId"]},
  {name:"来源",ids:["channelId","device"]},
  {name:"进群情况",ids:["joinedOn","progress"]},
  {name:"退群情况",ids:["normalLeft","normalLeftOn","abnormalLeft","abnormalLeftOn"]},
  {name:"客户情况",ids:["lossAmount","note"]},
  {name:"专家交接",ids:["addedExpert"]},
 ];
 const identity=[{name:"客户与状态",ids:["expertStatus","phone"]},{name:"负责人 / 安排",ids:["expertId","expertMode"]}];
 const notes={name:"跟进备注",ids:["customerProgress","expertNote"]};
 if(stage==="联系")return [...identity,{name:"客户情况",ids:["lossAmount","note"]},{name:"联系专家",ids:["addedExpert","expertOn"]},{name:"资料 / 追踪",ids:["submitted","traceStartedOn"]},notes];
 if(stage==="追踪")return [...identity,{name:"追踪情况",ids:["traceStartedOn","accurateAmount"]},{name:"注册交接",ids:["invitedOn","registeredOn"]},notes];
 if(stage==="注册")return [...identity,{name:"注册 / 开户",ids:["invitedOn","registeredOn"]},{name:"开单情况",ids:["firstDeposit","firstDepositOn","firstDepositMethod","investmentTotal"]},notes];
 if(stage==="开单")return [...identity,{name:"开户日期",ids:["registeredOn"]},{name:"资金情况",ids:["firstDeposit","firstDepositOn","firstDepositMethod","investmentTotal"]},notes];
 return [...identity,{name:"联系 / 资料",ids:["addedExpert","expertOn","submitted"]},{name:"追踪 / 注册",ids:["traceStartedOn","invitedOn","registeredOn"]},{name:"资金情况",ids:["firstDeposit","firstDepositOn","firstDepositMethod","investmentTotal"]},notes];
}
