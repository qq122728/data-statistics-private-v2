"use client";
import { useEffect, useRef, useState } from "react";
import type { SheetPayload, SheetData } from "./schema";
import MonthDaySelect from "./MonthDaySelect";
import type { HeaderChoice, HeaderQuestion } from "./number-import";
import styles from "./CustomerSheet.module.css";
import { requestErrorMessage, requestJson } from "./request-error";
type Matrix={skippedExamples?:number;headers:string[];rows:string[][];sources?:{sheet:string;row:number;stage:"pending"|"group"|"expert"|null}[]};
const stageNames:Record<string,string>={pending:"待进群",group:"在群跟进",expert:"专家跟进"};
const historicalOwnerAvailableOn=(owner:NonNullable<SheetPayload["historicalOwners"]>[number],date:unknown)=>!date||owner.periods.some(period=>period.from<=String(date).slice(0,10)&&(!period.to||period.to>=String(date).slice(0,10)));
type Plan={fingerprint:string;added:number;updated:number;unchanged:number;errors:number;records:{line:number;phone:string;kind:string;error?:string;channel?:{input:string;source:string;unified:string};changes:{key:string;label:string;before:string;after:string;conflict:boolean;choice:string;locked:boolean}[]}[]};
async function api<T>(url:string,init?:RequestInit):Promise<T>{return requestJson<T>(url,init,"导入客户");}
export default function CustomerImportWizard({payload,initialStage="pending",onSaved,onBusy,conversation=false,attachment,draft,onNotice,onRead}:{payload:SheetPayload;initialStage?:string;onSaved?:()=>void;onBusy?:(v:boolean)=>void;conversation?:boolean;attachment?:{id:number;file?:File;text?:string};draft?:{id:number;stage?:"pending"|"group"|"expert";defaults?:Record<string,string>};onNotice?:(text:string)=>void;onRead?:(headers:string[],count:number)=>void}){
 const [stage,setStage]=useState(initialStage);const [stageConfirmed,setStageConfirmed]=useState(false);const [defaults,setDefaults]=useState<SheetData>({intakeOn:payload.today||"",channelId:conversation?"":payload.channels[0]?.id||"",ownerId:conversation?"":payload.actorId});
 const [headerQuestion,setHeaderQuestion]=useState<HeaderQuestion|null>(null);
 const readSource=useRef<{file?:File;text:string;choices:Record<string,HeaderChoice>}|null>(null);
 const [text,setText]=useState("");const [matrix,setMatrix]=useState<Matrix|null>(null);const [mapping,setMapping]=useState<string[]>([]);
 const [choices,setChoices]=useState<Record<string,string>>({});const [plan,setPlan]=useState<Plan|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [message,setMessage]=useState("");const [includeNew,setIncludeNew]=useState(true);const [includeUpdates,setIncludeUpdates]=useState(true);
 const readId=useRef<number|undefined>(undefined);const draftId=useRef<number|undefined>(undefined);
 useEffect(()=>{if(attachment&&readId.current!==attachment.id){readId.current=attachment.id;void read(attachment.file,attachment.text);}},[attachment]);
 useEffect(()=>{if(draft&&draftId.current!==draft.id){draftId.current=draft.id;if(draft.stage)setStage(draft.stage);if(draft.defaults)setDefaults(v=>({...v,...draft.defaults}));setPlan(null);setChoices({});}},[draft]);
 async function run(task:()=>Promise<void>){setBusy(true);onBusy?.(true);setError("");setMessage("");try{await task();}catch(e){setError((e as Error).message);onNotice?.((e as Error).message);}finally{setBusy(false);onBusy?.(false);}}
 const invalidate=()=>{setPlan(null);setChoices({});};
 async function read(file?:File,pasted?:string,choices:Record<string,HeaderChoice>={}){await run(async()=>{
  invalidate();setMatrix(null);setMapping([]);setHeaderQuestion(null);
  const contents=pasted??text;readSource.current={file,text:contents,choices};
  const form=new FormData();form.set("groupId",payload.groupId);form.set("mode","numbers");form.set("headerChoices",JSON.stringify(choices));
  if(file)form.set("file",file);else form.set("text",contents);
  let response:Response;try{response=await fetch("/api/customer-sheet/import",{method:"POST",body:form});}catch(error){throw Error(requestErrorMessage(error,"读取名单"));}
  const p=await response.json() as Matrix&{error?:string;headerQuestion?:HeaderQuestion};
  if(!response.ok){if(p.headerQuestion){setHeaderQuestion(p.headerQuestion);return;}throw Error(p.error||"名单读取失败");}
  setMatrix(p);onRead?.(p.headers,p.rows.length);
  const aliases:Record<string,string>={"进群客户":"phone","号码":"phone","手机号":"phone","手机号码":"phone","电话号码":"phone","phone":"phone","客户号码":"phone","接粉负责人":"ownerId","群负责人":"operatorId","备注":"note","进群时间":"joinedOn","加专家日期":"expertOn","注册日期":"registeredOn","开单日期":"firstDepositOn"};
  setMapping(p.headers.map(h=>payload.columns.find(c=>c.name===h.trim())?.id||aliases[h.trim()]||""));
 });}
 function chooseHeader(choice:HeaderChoice){const source=readSource.current;if(source&&headerQuestion)void read(source.file,source.text,{...source.choices,[headerQuestion.sheet]:choice});}

 function request(){if(!matrix)throw Error("请先读取文件");if(conversation&&!defaults.ownerId&&!mapping.includes("ownerId"))throw Error("请先确认接粉负责人是谁");if(conversation&&stage!=="pending"&&!defaults.operatorId&&!mapping.includes("operatorId"))throw Error("请先确认群内负责人是谁");const keys=mapping.filter(Boolean);if(!keys.includes("phone"))throw Error("请把号码列对应到客户号码");if(new Set(keys).size!==keys.length)throw Error("一个字段不能对应两列");return {groupId:payload.groupId,stage,rowStages:matrix.sources?.map(s=>s.stage),defaults,choices,rows:matrix.rows.map(cells=>Object.fromEntries(cells.flatMap((v,i)=>mapping[i]&&v.trim()?[[mapping[i],v.trim()]]:[])))};}
 async function preview(nextChoices=choices){await run(async()=>{setPlan(null);const p=await api<Plan>("/api/customer-sheet/import/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...request(),choices:nextChoices})});setChoices(nextChoices);setPlan(p);onNotice?.(p.records.some(r=>r.error)?`名单检查发现：${[...new Set(p.records.flatMap(r=>r.error?[r.error]:[]))].slice(0,3).join("；")}。请补充信息，再检查确认卡片。`:`检查完成，尚未保存：待新增${p.added}人、待更新${p.updated}人、无需修改${p.unchanged}人。请核对卡片，点击确认后才会保存。`);});}
 async function save(){if(!plan)return;await run(async()=>{const result=await api<{added:number;updated:number;skipped:number}>("/api/customer-sheet/import/plan",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...request(),fingerprint:plan.fingerprint,includeNew,includeUpdates})});const done=`已保存：新增${result.added}人，更新${result.updated}人，未改动${result.skipped}人。黑客组按发生日期同步日报；律师组手填日报不变。`;setMessage(done);onNotice?.(done);setPlan(null);setMatrix(null);setText("");onSaved?.();window.dispatchEvent(new Event("ai-data-updated"));});}
 const autoStages=matrix?.sources?.some(s=>s.stage)||false;
 const allAutoStages=!!matrix?.sources?.length&&matrix.sources.every(s=>s.stage);
 const needsExpert=stage==="expert"||matrix?.sources?.some(s=>s.stage==="expert");
 const needsGroup=stage!=="pending"||matrix?.sources?.some(s=>s.stage==="group"||s.stage==="expert");
 const sourceLabel=(line:number)=>{const source=matrix?.sources?.[line-1];return source?`${source.sheet} · 第${source.row}行${source.stage?` · ${stageNames[source.stage]}`:""}`:`第${line}行`;};
 const needsStageChoice=conversation&&!draft?.stage&&!allAutoStages&&!stageConfirmed;
 const selectedErrors=plan?.records.some(r=>r.error&&(r.kind==="new"?includeNew:r.kind==="update"||r.kind==="unchanged"?includeUpdates:true));
 const peopleFor=(key:string)=>payload.members.filter(m=>key==="ownerId"||m.roles.includes(key==="expertId"?"EXPERT":"GROUP_OPERATOR")||key==="operatorId"&&m.roles.includes("LEAD"));
 const historicalPeopleFor=(key:string)=>key==="ownerId"&&payload.canChooseHistoricalOwner?(payload.historicalOwners||[]).filter(owner=>historicalOwnerAvailableOn(owner,defaults.intakeOn)):[];
 return <div className={styles.importWizard}>
 <fieldset disabled={busy}>
 {conversation&&<div className={styles.importSummary}>导入确认卡片 · {autoStages?"按业务阶段识别":stageNames[stage]}{matrix?` · ${matrix.rows.length}行`:""}</div>}
 <details open><summary>{conversation?"核对 / 调整字段、日期和负责人":"导入设置"}</summary>
 <label>导入阶段 {allAutoStages?<span>已识别业务阶段：{[...new Set(matrix!.sources!.map(s=>stageNames[s.stage!]))].join("、")}</span>:<select aria-label="导入阶段" value={stage} onChange={e=>{setStage(e.target.value);setStageConfirmed(true);invalidate();}}><option value="pending">接粉 / 待进群</option><option value="group">在群跟进</option><option value="expert">专家跟进</option></select>}</label>
 <div className={styles.templateDownloads}><a href={`/api/customer-sheet/template?${new URLSearchParams({groupId:payload.groupId})}`} download>下载统一 Excel 模板</a><span>一张表，每行下拉选择业务阶段：待进群 / 在群跟进 / 专家跟进</span></div>
 {matrix?.sources&&<p>已读取：{[...new Set(matrix.sources.map(s=>s.sheet))].map(name=>`${name} ${matrix.sources!.filter(s=>s.sheet===name).length}人`).join("；")}。每个客户填一行；业务阶段按每行所选内容识别。</p>}
 <p>只允许导入有效客户。撞粉、低金额、无 WS 号码、人工无效请从名单移除；历史记录保留。</p>
 <p>模板第2—4行为示例，可整行删除；从第5行填写真实客户。示例会自动跳过，请勿只清除示例的说明文字。群操作员、专家负责人可下拉选择本组人员；人员变化后请重新下载模板，本人负责的客户可选择本组对应岗位负责人。</p>
 {payload.canChooseHistoricalOwner&&payload.historicalOwners?.length?<p>补录本组老客户时，接粉负责人可选择“历史成员·已调组”；群负责人和专家负责人仍只能选择本组当前在职人员。</p>:null}
 {matrix?.skippedExamples? <p>已自动跳过 {matrix.skippedExamples} 行模板示例。</p>:null}
 <p>完整号码自动匹配本组客户。空白格不清除已有资料；接粉归属保持原样。统一值只补空白；映射了文件渠道列时，按文件里的渠道检查，不会用上方统一渠道覆盖。若整批统一渠道，请将文件渠道列设为“不导入”，再选统一渠道；已有客户原渠道仍默认保留。</p>
 {[
  {title:"接粉信息",keys:["intakeOn","channelId","ownerId"]},
  {title:"回复信息",keys:["replied","repliedOn"]},
  {title:"进群信息",keys:needsGroup?["joinedOn","operatorId"]:["operatorId"]},
  ...(needsExpert?[{title:"专家信息",keys:["expertOn","expertId"]}]:[]),
 ].map(section=><section key={section.title} className={styles.importSection} aria-label={section.title}><h4>{section.title}</h4><div className={styles.formGrid}>{section.keys.map(key=>{const c=payload.columns.find(c=>c.id===key)!;const label=key==="operatorId"?"群负责人（群操作员）":key==="ownerId"?"接粉负责人":c.name;return <label key={key}>{label}（统一值）{["date","datetime"].includes(c.kind)?<MonthDaySelect label={`导入统一${c.name}`} max={payload.today} value={String(defaults[key]||"")} onChange={v=>{setDefaults(d=>({...d,[key]:v}));invalidate();}}/>:<select aria-label={`导入统一${label}`} value={String(defaults[key]||"")} onChange={e=>{setDefaults(d=>({...d,[key]:e.target.value}));invalidate();}}><option value="">不设置</option>{key==="replied"?<><option value="是">是</option><option value="否">否</option></>:key==="channelId"?payload.channels.map(m=><option key={m.id} value={m.id}>{m.name}</option>):<>{peopleFor(key).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}{historicalPeopleFor(key).map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</>}</select>}</label>;})}</div></section>)}
 {needsExpert&&<p>专家导入需核对进群日期和群负责人：已有客户自动沿用原资料，缺失时请补齐；进群日期不会使用加专家日期代替。本人负责的客户可选择本组对应岗位负责人。</p>}
 <p>接粉日期默认为当前统计日；历史名单请改为真实日期。接粉、回复、进群、加专家、追踪、邀请注册、开户、首充按实际先后填写，允许同一天；选填步骤可留空。退群不能早于进群，续充或出金不能早于已填写的首充日期。进群、加专家、回复、退群及开单等缺少发生日期会提示补齐。</p>
 {!matrix?<><label className={styles.file}>上传 Excel / CSV / TSV<input aria-label="客户批量导入文件" type="file" accept=".xlsx,.csv,.tsv,.txt" onChange={e=>{if(e.target.files?.[0])void read(e.target.files[0]);e.target.value="";}}/></label><textarea aria-label="粘贴客户导入表格" className={styles.paste} value={text} onChange={e=>{setText(e.target.value);setHeaderQuestion(null);}} placeholder="粘贴表格或一列完整号码"/><button disabled={!text.trim()} onClick={()=>void read()}>读取并识别表头</button></>:<><p>已读取 {matrix.rows.length} 行待检查名单，尚未保存。核对字段对应，预览前5行：</p><div className={styles.preview}><table><thead><tr>{matrix.headers.map((h,i)=><th key={i}>{h}{h==="业务阶段"?<span>（自动识别）</span>:<select aria-label={`导入第${i+1}列对应字段`} value={mapping[i]} onChange={e=>{setMapping(v=>v.map((x,j)=>j===i?e.target.value:x));invalidate();}}><option value="">不导入</option>{payload.columns.filter(c=>!c.hidden&&!["status","expertStatus","progress"].includes(c.id)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}</th>)}</tr></thead><tbody>{matrix.rows.slice(0,5).map((r,i)=><tr key={i}>{matrix.headers.map((_,j)=><td key={j}>{mapping[j]==="phone"?"号码已读取":r[j]}</td>)}</tr>)}</tbody></table></div><button onClick={()=>{setMatrix(null);invalidate();}}>重新选择名单</button><button className={styles.primary} disabled={needsStageChoice} onClick={()=>void preview()}>检查新增与更新</button></>}
 {headerQuestion&&<section className={styles.importSection} aria-label="确认名单第一行"><h4>请确认“{headerQuestion.sheet}”的第一行</h4><p>下面这行是列标题，还是第一位客户？确认后会重新读取原名单，当前没有保存。</p><p>{headerQuestion.firstRow.join(" ｜ ")}</p><button onClick={()=>chooseHeader("customer")}>第一行也是客户，保留</button><button onClick={()=>chooseHeader("header")}>第一行是列标题</button></section>}
 </details>
 {needsStageChoice&&matrix&&<p role="status">请在上方按钮或“导入阶段”下拉框中确认这批客户的阶段，再点击检查。</p>}
 {conversation&&matrix&&<button className={styles.primary} disabled={needsStageChoice} onClick={()=>void preview()}>检查并生成确认卡片</button>}
 {plan&&<><div className={styles.importSummary}><label><input type="checkbox" checked={includeNew} onChange={e=>setIncludeNew(e.target.checked)}/>待新增 {plan.added} 人</label><label><input type="checkbox" checked={includeUpdates} onChange={e=>setIncludeUpdates(e.target.checked)}/>待更新 {plan.updated} 人</label><span>无需修改 {plan.unchanged} 人</span><span>错误 {plan.errors} 行</span><strong>尚未保存</strong></div><p>有冲突的字段默认保留原值。选择替换会重新检查；已有接粉归属不能在这里更改。</p><div className={styles.importRecords}>{plan.records.map(r=><details key={r.line} open={!!r.error||r.changes.some(c=>c.conflict)}><summary>{sourceLabel(r.line)} · {r.phone} · {r.error?"错误，不能保存":{new:"待新增",update:"待更新已有客户",unchanged:"无需修改",error:"无法识别"}[r.kind]}</summary>{r.channel&&<p>渠道来源：{r.channel.source} · 输入值：{payload.channels.find(c=>c.id===r.channel!.input)?.name||r.channel.input}{r.channel.source==="文件"&&r.channel.unified?` · 上方统一渠道：${r.channel.unified}（仅补空白）`:""}</p>}{r.error&&<p role="alert" className={styles.error}>{r.error}</p>}{r.changes.map(c=><div key={c.key} className={styles.importChange}><strong>{c.label}</strong><span>{c.before} → {c.after}</span>{c.conflict?<select aria-label={`第${r.line}行${c.label}冲突处理`} value={c.choice} onChange={e=>void preview({...choices,[`${r.line}:${c.key}`]:e.target.value})}><option value="keep">保留原值</option><option value="replace" disabled={c.locked}>使用导入值</option></select>:<span>{c.locked?"无权限":"补充"}</span>}</div>)}</details>)}</div><p>确认后才写入客户资料并生成动作编号。黑客组同步对应日期日报；律师组手填日报不变。</p><button className={styles.primary} disabled={!!selectedErrors||!(includeNew&&plan.added||includeUpdates&&plan.updated)} onClick={()=>void save()}>确认保存所选新增与更新</button></>}
 </fieldset>{busy&&<p role="status">正在检查或保存，请稍候…</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.importSuccess}>{message}</p>}
 </div>;
}
