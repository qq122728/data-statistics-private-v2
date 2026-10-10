export type ImportDraft={mode?:"auto"|"import"|"update";stage?:"pending"|"group"|"expert";defaults?:Record<string,string|number|boolean|null>;fund?:{amount:number;date:string;method:"bank"|"crypto";kind:"recharge"|"withdrawal"}};
/** Never send complete customer numbers from chat text to the external model. */
export function redactChatText(text:string){return text.replace(/\d[\d ()+-]{4,}\d/g,value=>/^\d{4}-\d{2}-\d{2}$/.test(value)?value:value.replace(/\D/g,"").length>=6?"[号码已隐藏]":value);}
export function compactChat(messages:{role:"user"|"assistant";content:string}[]){
 const result:typeof messages=[];let size=0;
 for(const m of [...messages].reverse().slice(0,12)){const content=redactChatText(m.content).slice(0,1000);if(size+content.length>5500)break;result.unshift({role:m.role,content});size+=content.length;}
 return result;
}

/** A leading list is data; keep it local and send only the remaining instructions to AI. */
export function extractChatNumbers(content:string){
 const match=content.trim().match(/^(\d{6,20}(?!\d)(?:[\s,，;；、]+\d{6,20}(?!\d))*)(?:[\s,，;；、]+|$)([\s\S]*)$/);
 if(!match)return null;
 const numbers=match[1].split(/[\s,，;；、]+/);
 if(numbers.length>500)throw Error("每次最多导入500个号码，请分批发送");
 return {text:numbers.join("\n"),count:numbers.length,instructions:match[2].trim()};
}
/** Conservative offline draft for explicit month/day dates. Missing fields stay empty. */
export function explicitChatDates(content:string,today:string):ImportDraft{
 content=content.replace(/(?<!\d)(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?!\d)/g,"$1年$2月$3号").replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g,"$1月$2号");
 const defaults:Record<string,string>={};
 const date="(?:(\\d{4})年)?(\\d{1,2})月(\\d{1,2})(?:日|号)?(?!\\d)";
 for(const [key,label] of [["intakeOn","接粉"],["joinedOn","进群"],["expertOn","加专家"],["repliedOn","回复"]]){
  const forward=content.match(new RegExp(label+"(?:日期|时间)?(?:是|为|在)?\\s*"+date));
  const backward=content.match(new RegExp(date+"\\s*(?:已)?"+label));
  const m=forward||backward;if(!m)continue;
  const year=Number(m[1]||today.slice(0,4)),month=Number(m[2]),day=Number(m[3]);
  const check=new Date(Date.UTC(year,month-1,day));
  if(check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw Error(`${label}日期不存在，请更正后再发送`);
  defaults[key]=`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
 }
 if(defaults.repliedOn)defaults.replied="是";
 return {stage:defaults.expertOn?"expert":defaults.joinedOn?"group":defaults.intakeOn?"pending":undefined,defaults};
}

/** Unambiguous ordinary replies also work without the external model. */
export function localConversationDraft(content:string,today:string,actorId:string,members:{id:string;name:string;roles:string[]}[],channels:{id:string;name:string}[]):ImportDraft{
 const dated=content.replace(/已经开户|开户/g,'注册').replace(/追踪开始/g,'追踪').replace(/今天/g,`${Number(today.slice(5,7))}月${Number(today.slice(8,10))}号`);
 const parsed=explicitChatDates(dated,today);
 const defaults={...parsed.defaults};
 const quality=content.match(/(?:号码情况|号码质量|状态|都是|这批是)(?:改为|是|为|[:：])?\s*(有效|撞粉|低金额|无\s*WS(?:\s*号码)?|人工无效)/i)?.[1];
 if(quality)defaults.quality=/^无/i.test(quality)?"无 WS 号码":quality;
 const dates=[['registeredOn','注册'],['traceStartedOn','追踪'],['invitedOn','邀请注册'],['firstDepositOn','首充'],['normalLeftOn','正常退群'],['abnormalLeftOn','异常退群']];
 for(const [key,label] of dates){
  const source=key==='registeredOn'?dated.replaceAll('邀请注册','邀请开户'):dated;
  if(!source.includes(label))continue;
  const d=explicitChatDates(source.replaceAll('接粉','接收').replaceAll(label,'接粉'),today).defaults?.intakeOn;if(d)defaults[key]=d;
 }
 for(const [key,label] of [['ownerId','(?:接粉(?:负责人|人)|前台)'],['operatorId','(?:群内负责人|群负责人|群操作员|炒群负责人)'],['expertId','专家负责人']]){
  const m=content.match(new RegExp(label+'(?:是|为|[:：])?\\s*([^，,。；;\\n]+)'));if(!m)continue;
  const name=m[1].trim();if(/^(我|本人|自己)$/.test(name)){defaults[key]=actorId;continue;}
  const candidates=members.filter(p=>p.name===name||p.name.replace(/[（(].*?[）)]/g,'')===name);
  if(candidates.length===1)defaults[key]=candidates[0].id;
 }
 const channel=content.match(/渠道(?:是|为|[:：])?\s*([^，,。；;\n]+)/)?.[1]?.trim();
 if(channel){const found=channels.filter(c=>c.name===channel);if(found.length===1)defaults.channelId=found[0].id;}
 if(/取消(?:已)?回复|未回复|没有回复/.test(content))defaults.replied=false;
 else if(/已回复|回复了/.test(content)||defaults.repliedOn)defaults.replied=true;
 if(/取消进群|清空进群日期/.test(content))defaults.joinedOn=null;
 if(/取消已加专家/.test(content))defaults.addedExpert=false;
 else if(/已加专家/.test(content)||defaults.expertOn)defaults.addedExpert=true;
 if(/未提交资料|取消提交资料/.test(content))defaults.submitted=false;
 else if(/已提交资料|提交资料了/.test(content))defaults.submitted=true;
 if(defaults.normalLeftOn)defaults.normalLeft=true;
 if(defaults.abnormalLeftOn)defaults.abnormalLeft=true;
 for(const [key,label] of [['note','客户情况备注'],['expertNote','专家备注'],['customerProgress','客户进展']]){const m=content.match(new RegExp(label+'(?:改为|是|为|[:：])\\s*(.+)'));if(m)defaults[key]=m[1].trim();}
 const first=content.match(/首充(?:金额)?(?:是|为|[:：])?\s*(\d+(?:\.\d{1,2})?)(?![\d./年月日号-])/);if(first)defaults.firstDeposit=Number(first[1]);
 if(first&&/银行卡/.test(content))defaults.firstDepositMethod='银行卡';if(first&&/加密货币/.test(content))defaults.firstDepositMethod='加密货币';
 let fund:ImportDraft['fund'];const money=content.match(/(续充|出金)(?:金额)?(?:是|为|[:：])?\s*(\d+(?:\.\d{1,2})?)(?![\d./年月日号-])/);
 if(money){const date=explicitChatDates(dated.replaceAll('接粉','接收').replaceAll(money[1],'接粉'),today).defaults?.intakeOn;const method=/银行卡/.test(content)?'bank':/加密货币/.test(content)?'crypto':undefined;if(date&&method)fund={amount:Number(money[2]),date:String(date),method,kind:money[1]==='续充'?'recharge':'withdrawal'};}
 return {...parsed,fund,mode:/新增|导入/.test(content)?'import':/更新|修改|取消|清空/.test(content)?'update':undefined,defaults};
}

/** Only complete, single date answers bypass AI; mixed instructions still use the model. */
export function isDirectDateReply(content:string){
 const day="(?:今天|(?:\\d{4}[-/年])?\\d{1,2}(?:月|/|-)\\d{1,2}(?:日|号)?)";
 const action="(?:接粉|回复|进群|加专家|注册|追踪|邀请注册|正常退群|异常退群|首充)";
 return new RegExp(`^(?:${action}(?:日期|时间)?(?:是|为|在)?\\s*${day}|${day}\\s*(?:已)?${action}(?:了)?)[。！!]?$`).test(content.trim())&&!!content.trim();
}
