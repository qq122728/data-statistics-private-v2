"use client";
import {useEffect,useRef,useState} from "react";
import {compactChat,extractChatNumbers,localConversationDraft,isDirectDateReply,type ImportDraft} from "../../../packages/customer-sheet/chat-import";
import type {SheetPayload,SheetData} from "../../../packages/customer-sheet/schema";
import styles from "./AiSmartAssistant.module.css";
import {requestJson,type BackendUser} from "@/lib/backend";
import {UsageHelp} from "./UsageHelp";
type Message={id:number;role:"user"|"assistant";content:string;system?:boolean};
type Matrix={headers:string[];rows:string[][];sources?:{stage:"pending"|"group"|"expert"|null}[]};
type Batch={rows:SheetData[];headers:string[];rowStages?:Matrix["sources"];draft:ImportDraft;choices:Record<string,"keep"|"replace">;requestId:string};
type Change={key:string;label:string;before:string;after:string;conflict:boolean;choice:string;locked:boolean};
type Plan={mode:string;fingerprint:string;added:number;updated:number;unchanged:number;records:{line:number;phone:string;kind:string;error?:string;changes:Change[]}[]};
const welcome="你好，直接发号码和要做的事，也可以上传 Excel。我会在对话中补问缺少的信息，再发文字摘要。你回复“确认执行”后才保存；回复“取消”可放弃本次操作。";
function mergeDraft(a:ImportDraft,b:ImportDraft):ImportDraft{return {...a,...b,mode:b.mode||a.mode,stage:b.stage||a.stage,defaults:{...a.defaults,...b.defaults},fund:b.fund||a.fund};}
function summary(plan:Plan){
 const groups=new Map<string,string[]>();
 for(const r of plan.records){const detail=r.changes.filter(c=>c.key!=="phone").map(c=>`${c.label==="前台"?"接粉负责人":c.label==="群操作员"?"群内负责人":c.label}：${!c.before||c.before==="未填写"?"":c.before+" → "}${c.after}${c.conflict?`（${c.choice==="replace"?"使用新值":"保留原值"}）`:""}`).join("；")||"资料无需修改";groups.set(detail,[...(groups.get(detail)||[]),`第${r.line}行 ${r.phone}`]);}
 return `请核对：新增${plan.added}人，更新${plan.updated}人，无需修改${plan.unchanged}人。\n`+[...groups].map(([detail,people])=>`${people.join("、")}\n${detail}`).join("\n\n")+"\n\n以上内容确认无误，请回复“确认执行”；如需修改，直接告诉我。未确认不会保存。";
}
export function AiSmartAssistant({open,onOpenChange,user,contextLabel}:{open:boolean;onOpenChange:(v:boolean)=>void;contextLabel:string;user:BackendUser}){
 const canImport=Boolean(user.groupId)&&["LEAD","RECEPTION","GROUP_OPERATOR","EXPERT"].includes(user.role);
 const [messages,setMessages]=useState<Message[]>([{id:0,role:"assistant",content:canImport?welcome:"你好，可以咨询使用方法。管理账号仍按授权范围只读，不通过对话修改客户。",system:true}]);
 const [text,setText]=useState("");const [busy,setBusy]=useState(false);const [configured,setConfigured]=useState<boolean|null>(null);
 const [payload,setPayload]=useState<SheetPayload|null>(null);const [batch,setBatch]=useState<Batch|null>(null);const [lastPlan,setLastPlan]=useState<Plan|null>(null);
 const [question,setQuestion]=useState("");
 const [pending,setPending]=useState<{body:Record<string,unknown>;fingerprint:string}|null>(null);
 const bottom=useRef<HTMLDivElement>(null);const counter=useRef(1);const fileInput=useRef<HTMLInputElement>(null);
 const append=(content:string,role:"user"|"assistant"="assistant",system=false)=>setMessages(v=>[...v,{id:counter.current++,role,content,system}]);
 useEffect(()=>{if(open)void requestJson<{configured:boolean}>("/api/ai/chat").then(r=>setConfigured(r.configured)).catch(()=>setConfigured(null));},[open]);
 useEffect(()=>{bottom.current?.scrollIntoView({block:"nearest"});},[messages,busy]);
 async function context(){if(payload)return payload;if(!user.groupId)throw Error("当前账号没有可操作的小组");const p=await requestJson<SheetPayload>(`/api/customer-sheet?groupId=${encodeURIComponent(user.groupId)}&stage=pending`);setPayload(p);return p;}
 function bodyFor(b:Batch){return {groupId:user.groupId,mode:b.draft.mode||"auto",stage:b.draft.stage,rows:b.rows,defaults:b.draft.defaults||{},rowStages:b.rowStages?.map(s=>s.stage),choices:b.choices,...(b.draft.fund?{fund:{...b.draft.fund,requestId:b.requestId}}:{})};}
 async function check(b:Batch){
  setPending(null);setLastPlan(null);setQuestion("");
  const body=bodyFor(b);
  try{const plan=await requestJson<Plan>("/api/customer-sheet/conversation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});setLastPlan(plan);
   const errors=plan.records.filter(r=>r.error);if(errors.length){setQuestion(errors[0].error||"");append([...new Set(errors.map(r=>r.error))].join("\n")+"\n请在对话中补充或更正，尚未保存。");return;}
   const conflicts=plan.records.flatMap(r=>r.changes.filter(c=>c.conflict&&!b.choices[`${r.line}:${c.key}`]).map(c=>`第${r.line}行 ${r.phone} 的${c.label}：原来“${c.before}”，这次“${c.after}”。请回复“第${r.line}行${c.label}保留原值”或“第${r.line}行${c.label}使用新值”${c.locked?"（此字段无权替换，只能保留）":""}`));
   if(conflicts.length){append(conflicts.join("\n"));return;}
   if(!plan.added&&!plan.updated){append("这些资料已经一致，无需保存。你还要更新哪项进度？");return;}
   setPending({body,fingerprint:plan.fingerprint});append(summary(plan));
  }catch(e){setQuestion((e as Error).message);append((e as Error).message+"\n请直接回复补充信息，尚未保存。");}
 }
 async function readFile(file:File){setBusy(true);setPending(null);setLastPlan(null);setBatch(null);try{
  const p=await context();const form=new FormData();form.set("groupId",p.groupId);form.set("mode","numbers");form.set("file",file);
  const response=await fetch("/api/customer-sheet/import",{method:"POST",body:form});const matrix=await response.json() as Matrix&{error?:string};if(!response.ok)throw Error(matrix.error||"文件读取失败");
  const aliases:Record<string,string>={"进群客户":"phone","号码":"phone","手机号":"phone","客户号码":"phone","接粉负责人":"ownerId","群负责人":"operatorId","群内负责人":"operatorId","备注":"note","进群时间":"joinedOn","加专家日期":"expertOn","注册日期":"registeredOn","开单日期":"firstDepositOn"};
  const mapping=matrix.headers.map(h=>p.columns.find(c=>c.name===h.trim())?.id||aliases[h.trim()]||"");
  const unknown=matrix.headers.filter((h,i)=>!mapping[i]&&h!=="业务阶段"&&matrix.rows.some(r=>r[i]?.trim()));if(unknown.length)throw Error(`这些表头还不能识别：${unknown.join("、")}。请使用统一模板，避免漏掉资料。`);
  const keys=mapping.filter(Boolean);if(!keys.includes("phone")||new Set(keys).size!==keys.length)throw Error("请检查客户号码列，且每个字段只能有一列");
  const next:Batch={rows:matrix.rows.map(r=>Object.fromEntries(r.flatMap((v,i)=>mapping[i]&&v.trim()?[[mapping[i],v.trim()]]:[]))),headers:matrix.headers,rowStages:matrix.sources,draft:{mode:"import"},choices:{},requestId:crypto.randomUUID()};
  setBatch(next);append(`上传${file.name}，已读取${next.rows.length}行。`,"user",true);await check(next);
 }catch(e){append((e as Error).message);}finally{setBusy(false);}}
 async function send(){const content=text.trim();if(!content||busy)return;setText("");append(content,"user");setBusy(true);
  try{
   if(/^(确认执行|确认导入|确认更新|确认保存|确认)[。！!]?$/u.test(content)){
    if(!pending){append("还没有可确认的完整方案。请先补齐刚才询问的信息；我发出核对摘要后再确认。");return;}
    const result=await requestJson<{added:number;updated:number;skipped:number}>("/api/customer-sheet/conversation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...pending.body,fingerprint:pending.fingerprint})});
    setPending(null);setLastPlan(null);setBatch(v=>v?{...v,rows:v.rows.map(r=>({phone:r.phone})),rowStages:undefined,draft:{mode:"update"},choices:{},requestId:crypto.randomUUID()}:null);append(`已保存：新增${result.added}人，更新${result.updated}人。黑客组已按实际发生日期更新统计；律师组手填日报不变。`);window.dispatchEvent(new Event("ai-data-updated"));return;
   }
   setPending(null);
   if(/^(取消|放弃|取消本次操作|重新开始)[。！!]?$/u.test(content)){setBatch(null);setLastPlan(null);append("已取消本次待确认操作，没有保存。");return;}
   if(/续充[\s\S]*出金|出金[\s\S]*续充/.test(content))throw Error("续充和出金请分两条消息发送，每笔分别核对，避免混记");
   let next=batch;
   const numbers=canImport?extractChatNumbers(content.replace(/^(?:号码|客户号码|更新号码|更新客户)\s*[:：]?\s*/,"")):null;
   if(numbers){next={rows:numbers.text.split("\n").map(phone=>({phone})),headers:["客户号码"],draft:{},choices:{},requestId:crypto.randomUUID()};setBatch(next);setLastPlan(null);append(`已识别${numbers.count}个号码。先核对资料和权限，不会立即保存。`);}
   if(next){
    const p=await context();if(!p.today)throw Error("无法获取统计日期，请刷新后重试");
    const decision=content.match(/^第(\d+)行(.+?)(保留原值|使用新值)[。]?$/);
    if(decision&&lastPlan&&!numbers){const row=lastPlan.records.find(r=>r.line===Number(decision[1]));const change=row?.changes.find(c=>c.label===decision[2]);if(!change)throw Error("没有找到这项冲突，请按刚才的行号和字段名称回复");next={...next,choices:{...next.choices,[`${row!.line}:${change.key}`]:decision[3]==="使用新值"?"replace":"keep"}};}
    else {
     const expected=!numbers&&!/不能早于|不能晚于|不能直接清空/.test(question)?question.includes("群内负责人")?"群内负责人":question.includes("接粉负责人")?"接粉负责人":question.includes("专家负责人")?"专家负责人":question.includes("缺少渠道")?"渠道":question.includes("回复日期")?"回复日期":question.includes("接粉日期")?"接粉日期":question.includes("进群日期")?"进群日期":question.includes("加专家日期")?"加专家日期":question.includes("追踪开始日期")?"追踪日期":question.includes("邀请注册日期")?"邀请注册日期":question.includes("开户日期")?"注册日期":question.includes("首充日期")?"首充日期":"":"";
     const answer=expected&&!content.includes(expected)&&!/[，,。；;\n]/.test(content)?`${expected}是${content.replace(/^是\s*/,"")}`:content;
     const local=expected==="群内负责人"&&/^(先不选|暂不选择?|不选|稍后再选|暂不分配|还没确定)[。！!]?$/u.test(content)?{defaults:{operatorId:null}}:localConversationDraft(numbers?numbers.instructions:answer,p.today,p.actorId,p.members,p.channels);next={...next,draft:mergeDraft(next.draft,local)};setBatch(next);
     if(configured===true&&!(expected&&Object.keys(local.defaults||{}).length)&&!isDirectDateReply(content)){const response=await requestJson<{reply:string;draft?:ImportDraft}>("/api/ai/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:compactChat([...(numbers?[]:messages.filter(m=>!m.system).map(m=>({role:m.role,content:m.content}))),{role:"user",content}]),contextLabel,importContext:{mode:next.draft.mode,stage:next.draft.stage,defaults:next.draft.defaults,headers:next.headers,rowCount:next.rows.length}})});if(response.draft)next={...next,draft:mergeDraft(next.draft,{...response.draft,defaults:{...response.draft.defaults,...local.defaults}})};}
    }
    setBatch(next);await check(next);return;
   }
   const response=await requestJson<{reply:string}>("/api/ai/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:compactChat([...messages.filter(m=>!m.system).map(m=>({role:m.role,content:m.content})),{role:"user",content}]),contextLabel})});append(response.reply);
  }catch(e){setPending(null);append((e as Error).message);setText(content);}finally{setBusy(false);}
 }
 if(!open)return <><UsageHelp user={user}/><button className={styles.launch} onClick={()=>onOpenChange(true)}>AI 助手</button></>;
 return <aside className={styles.panel} aria-label="AI 对话助手">
  <header><div><h2>AI 助手</h2><span>{configured===true?"AI 对话已配置":configured===false?"基础对话可用 · AI 待连接":"正在检查 AI 连接"}</span></div><UsageHelp user={user}/><button disabled={busy} onClick={()=>onOpenChange(false)}>关闭</button></header>
  <div className={styles.history}><div role="log" aria-live="polite" aria-label="聊天记录">{messages.map(m=><div key={m.id} className={m.role==="user"?styles.user:styles.assistant}><small>{m.role==="user"?"你":"AI 助手"}</small><div>{m.content}</div></div>)}{busy&&<div role="status">正在核对…</div>}</div><div ref={bottom}/></div>
  <footer>{canImport&&<div className={styles.actions}><input ref={fileInput} hidden type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="上传客户名单" onChange={e=>{const f=e.target.files?.[0];if(f)void readFile(f);e.target.value="";}}/><button disabled={busy} onClick={()=>fileInput.current?.click()}>＋ 上传文件</button></div>}
   <textarea aria-label="AI 消息" value={text} onChange={e=>setText(e.target.value)} placeholder={canImport?"直接粘贴号码和说明，或继续回答刚才的问题":"输入使用问题"} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
   <div className={styles.send}><small>Enter 发送 · 回复“确认执行”才保存</small><button disabled={busy||!text.trim()} onClick={()=>void send()}>发送</button></div>
  </footer>
 </aside>;
}
