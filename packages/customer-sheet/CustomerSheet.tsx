"use client";
import { actualDateFields } from "./progress-dates";
import CustomerImportWizard from "./CustomerImportWizard";
import CustomerFinder from "./CustomerFinder";
import CustomerPagination from "./CustomerPagination";
import { CustomerDateToolbar, CustomerSheetToolbar } from "./CustomerSheetControls";
import CustomerSheetTable from "./CustomerSheetTable";
import { customerStageNames, type CustomerLocation } from "./navigation";
import { rowDate } from "./date-groups";
import { groupDays } from "./group-days";
import { fieldActionNumber } from "./action-numbers";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CellValue, Column, SheetData, SheetPayload, SheetRow } from "./schema";
import styles from "./CustomerSheet.module.css";
import { parseSheetText } from "./clipboard";
import { isPendingCustomer, customerGroupStatus, customerExpertStatus, expertStages, expertStatuses, viewColumns } from "./schema";
import InlineSheetCell from "./InlineSheetCell";
import NumberStatistics from "./NumberStatistics";
import InvestmentDialog from "./InvestmentDialog";
import { investmentSummary } from "./investment";
import MonthDaySelect from "./MonthDaySelect";
import { monthDay } from "./month-day";
import { sheetLayout } from "./layout";
import { requestJson } from "./request-error";
import useCustomerCellSave from "./useCustomerCellSave";
async function api<T>(url:string, init?:RequestInit):Promise<T>{
 return requestJson<T>(url,init,"客户资料操作");
}
const historicalOwnerAvailableOn=(owner:NonNullable<SheetPayload["historicalOwners"]>[number],date:unknown)=>!date||owner.periods.some(period=>period.from<=String(date).slice(0,10)&&(!period.to||period.to>=String(date).slice(0,10)));
const json=(method:string,body:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
export default function CustomerSheet({groups=[],initialGroupId,initialView="group",initialMine=false,preferenceKey}:{initialView?:string;initialMine?:boolean;preferenceKey?:string;groups?:{id:string;name:string}[];initialGroupId?:string}){
 const [dateRange,setDateRange]=useState("all");
 const [dateFrom,setDateFrom]=useState("");const [dateTo,setDateTo]=useState("");
 const [dateExpansion,setDateExpansion]=useState<Record<string,boolean>>({});
 function viewLabel(stage:string){return stage==="pending"?"接粉日期":stage==="expert"?"加专家日期":"进群日期";}
 const [showStatistics,setShowStatistics]=useState(false);
 const [groupId,setGroupId]=useState(initialGroupId||groups[0]?.id||"");
 const [trash,setTrash]=useState(false);
 const [findOpen,setFindOpen]=useState(false);
 const [focusId,setFocusId]=useState<string|null>(null);
 const focusedRow=useRef<HTMLTableRowElement|null>(null);
 const sheetScroll=useRef<HTMLDivElement|null>(null);
 const scrolledFocus=useRef("");
 const lastFocusedElement=useRef<HTMLTableRowElement|null>(null);
 const [deletionRow,setDeletionRow]=useState<SheetRow|null>(null);
 const [payload,setPayload]=useState<SheetPayload|null>(null);
 const [view,setView]=useState(initialView); const [expertStage,setExpertStage]=useState("全部"); const [mine,setMine]=useState(initialMine);const [responsibility,setResponsibility]=useState("owner");const [assignee,setAssignee]=useState("me");const [q,setQ]=useState("");const [status,setStatus]=useState(initialView==="group"?"正常在群":""); const [page,setPage]=useState(1);
 const [error,setError]=useState(""); const [busy,setBusy]=useState(false); const [saved,setSaved]=useState("");
 const [editing,setEditing]=useState<{row:SheetRow;column:Column}|null>(null);
 const [modal,setModal]=useState<"import"|"columns"|"paste"|null>(null);
 const [selection,setSelection]=useState<{row:number;column:number;endRow:number;endColumn:number}|null>(null);
 const [pasteUpdates,setPasteUpdates]=useState<{id:string;version:number;values:SheetData}[]>([]);
 const [roomy,setRoomy]=useState(true);
 const [combined,setCombined]=useState(true);
 const [investmentRow,setInvestmentRow]=useState<SheetRow|null>(null);
 const [expandedRows,setExpandedRows]=useState<string[]>([]);
 const [addingRow,setAddingRow]=useState(false);
 const [newRow,setNewRow]=useState<SheetData>({});
 const [columnDraft,setColumnDraft]=useState({name:"",kind:"text",stage:"group",options:""});
 const [preferencesReady,setPreferencesReady]=useState(false);
 useEffect(()=>{try{const value=preferenceKey?JSON.parse(localStorage.getItem(`customer-view:${preferenceKey}`)||"null"):null;if(value&&["pending","group","expert"].includes(value.view)){setView(value.view);setStatus(value.view==="group"?"正常在群":"");}}catch{}setPreferencesReady(true);},[preferenceKey]);
 useEffect(()=>{if(preferencesReady&&preferenceKey)try{localStorage.setItem(`customer-view:${preferenceKey}`,JSON.stringify({view}));}catch{}},[view,mine,preferenceKey,preferencesReady]);
 const [hidden,setHidden]=useState<string[]>([]);
 const paused=useRef(false);
 const sequence=useRef(0);
 const configuredGroup=useRef("");
 const load=useCallback(async()=>{
 if(!groupId)return;const requestId=++sequence.current;
  try{const p=await api<SheetPayload>(`/api/customer-sheet?${new URLSearchParams({groupId,deleted:trash?"1":"0",stage:view,expertStage,mine:"0",responsibility:responsibility,assignee:mine?assignee:"all",q,status,dateFrom,dateTo,page:String(page),...(focusId?{focusId}:{})})}`);if(requestId===sequence.current){if(configuredGroup.current!==groupId){setHidden(p.columns.filter(c=>c.defaultHidden).map(c=>c.id));configuredGroup.current=groupId;}
    if(p.focus){setView(p.focus.stage);setTrash(p.focus.deleted);setMine(true);setResponsibility("owner");setAssignee(p.focus.ownerId===p.actorId?"me":p.focus.ownerId);setQ("");setStatus("");setExpertStage("全部");setDateRange("all");setDateFrom("");setDateTo("");setDateExpansion(v=>v[p.focus!.date]?v:{...v,[p.focus!.date]:true});}
    setPage(p.page);setPayload(p);}}
  catch(e){if(requestId===sequence.current){setError((e as Error).message);if(focusId)setFocusId(null);}}
 },[groupId,view,expertStage,mine,responsibility,assignee,q,status,page,dateFrom,dateTo,trash,focusId]);
 const {pendingSaves:cellSaves,saveCell}=useCustomerCellSave({payload,setPayload,reload:load,setSaveMessage:setSaved});
 paused.current=findOpen||busy||cellSaves>0||addingRow||!!editing||!!modal||!!selection||!!investmentRow||!!deletionRow;
 useEffect(()=>{if(!groupId&&(initialGroupId||groups[0]?.id))setGroupId(initialGroupId||groups[0].id);},[groupId,initialGroupId,groups]);
 useEffect(()=>{setPayload(null);void load();},[load]);
 useEffect(()=>{const refresh=()=>{if(!paused.current)void load();};const timer=setInterval(refresh,15000);window.addEventListener("focus",refresh);window.addEventListener("ai-data-updated",refresh);return()=>{clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("ai-data-updated",refresh);};},[load]);
 useEffect(()=>{
  if(!focusId||!payload?.focus||!focusedRow.current)return;
  const key=JSON.stringify([focusId,payload.page,payload.focus.stage,payload.focus.deleted,payload.focus.date]);
  if(scrolledFocus.current!==key||lastFocusedElement.current!==focusedRow.current){focusedRow.current.scrollIntoView({block:"center",behavior:"auto"});focusedRow.current.focus({preventScroll:true});scrolledFocus.current=key;lastFocusedElement.current=focusedRow.current;}
 },[payload,focusId]);
 function display(key:string,value:CellValue|undefined){
  if(value===null||value===undefined||value==="")return "—";
  if(["ownerId","operatorId","expertId"].includes(key))return payload?.members.find(m=>m.id===value)?.name||payload?.historicalOwners?.find(m=>m.id===value)?.label||payload?.referenceNames?.[String(value)]||String(value);
  if(key==="channelId")return payload?.channels.find(c=>c.id===value)?.name||payload?.referenceNames?.[String(value)]||String(value);
  if(["date","datetime"].includes(payload?.columns.find(c=>c.id===key)?.kind||""))return monthDay(value);
  if(key==="progress")return `${value} 天`;
  if(typeof value==="boolean")return value?"✓":"—";return String(value);
 }
 async function perform(action:()=>Promise<unknown>,close=true){
  setBusy(true);setError("");try{await action();if(close)setModal(null);setEditing(null);setSelection(null);setSaved("已保存");await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 function input(column:Column,value:CellValue|undefined,onChange:(v:CellValue)=>void,autoFocus=false){
  const label=column.name;
  if(["date","datetime"].includes(column.kind))return <MonthDaySelect max={actualDateFields.includes(column.id)?payload?.today:undefined} value={String(value??"")} onChange={onChange} label={label} autoFocus={autoFocus}/>;
  if(column.id==="progress")return <span title="自动计算，进群当天为第1天，退群后按退群日期停止累计">{display("progress",groupDays(newRow,payload?.today||""))}</span>;
  if(column.kind==="boolean")return <input autoFocus={autoFocus} aria-label={label} type="checkbox" checked={value===true} onChange={e=>onChange(e.target.checked)}/>;
  if(["member","channel","select"].includes(column.kind)){
   const role=column.id==="expertId"?"EXPERT":column.id==="operatorId"?"GROUP_OPERATOR":"RECEPTION";
   const currentChoices=payload!.members.filter(m=>(column.id==="ownerId"||m.roles.includes(role)||(column.id!=="expertId"&&m.roles.includes("LEAD")))&&(column.id!=="ownerId"||!addingRow||payload!.canChooseHistoricalOwner||m.id===payload!.actorId)).map(m=>({value:m.id,label:m.name}));
   const historicalChoices=column.id==="ownerId"&&payload!.canChooseHistoricalOwner?(payload!.historicalOwners||[]).filter(owner=>historicalOwnerAvailableOn(owner,newRow.intakeOn)).map(owner=>({value:owner.id,label:owner.label})):[];
   const choices=column.kind==="member"?[...currentChoices,...historicalChoices]:column.kind==="channel"?payload!.channels.map(c=>({value:c.id,label:c.name})):(column.options||[]).map(s=>({value:s,label:s}));
   return <select autoFocus={autoFocus} aria-label={label} value={String(value??"")} onChange={e=>onChange(e.target.value||null)}><option value="">未填写</option>{choices.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select>;
  }
  if(column.kind==="text" && column.id!=="phone")return <textarea autoFocus={autoFocus} aria-label={label} rows={2} maxLength={4000} value={String(value??"")} onChange={e=>onChange(e.target.value)}/>;
  return <input autoFocus={autoFocus} aria-label={label} type={column.kind==="datetime"?"datetime-local":column.kind==="date"?"date":["number","money"].includes(column.kind)?"number":"text"} step={column.kind==="money"?"0.01":column.kind==="number"?"any":undefined} min={["number","money"].includes(column.kind)?0:undefined} value={column.kind==="datetime"&&String(value??"").length===10?`${value}T00:00`:String(value??"")} onChange={e=>onChange(e.target.value)}/>;
 }
 function openNew(){
  setNewRow({ownerId:payload!.actorId,expertId:null,operatorId:payload!.members.find(m=>m.id===payload!.actorId)?.roles.includes("GROUP_OPERATOR")?payload!.actorId:null,status:"待跟进",...(view==="pending"?{intakeOn:payload?.today||"",channelId:payload?.channels[0]?.id||"",quality:"有效"}:{})});setError("");setEditing(null);setSelection(null);setAddingRow(true);
 }
 async function saveNewRow(){
  setBusy(true);setError("");
  try{
   await api("/api/customer-sheet/rows",json("POST",{groupId,rows:[newRow]}));
   setAddingRow(false);setNewRow({});setSaved("新客户已保存");setView(isPendingCustomer(newRow)?"pending":"group");
   setQ("");setStatus("");setDateRange("all");setDateFrom("");setDateTo("");setDateExpansion({});setPage(1);setMine(false);await load();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const availableColumns=viewColumns(payload?.columns||[],view);
 const columns=availableColumns.filter(c=>!hidden.includes(c.id)||["phone","status","expertStatus"].includes(c.id));
 function cellValue(row:SheetRow,key:string){return key==="progress"?groupDays(row.data,payload?.today||""):key==="investmentTotal"?investmentSummary(row.data).totalCents/100:key==="expertStatus"?customerExpertStatus(row.data):key==="phone"?row.phone:key==="ownerId"?row.ownerId:row.data[key];}
 function readOnlyReason(row:SheetRow,column:Column){
  if(["status","expertStatus","progress"].includes(column.id))return "系统根据客户记录自动计算";
  const name=(id:unknown)=>payload?.members.find(member=>member.id===id)?.name||payload?.referenceNames?.[String(id)]||"未指定";
  if(column.stage==="expert")return row.data.expertId?`只读：仅专家负责人 ${name(row.data.expertId)} 可编辑`:`只读：请先指定专家负责人`;
  if(column.stage==="group")return `只读：仅接粉负责人 ${name(row.ownerId)} 或群负责人 ${name(row.data.operatorId||row.ownerId)} 可编辑`;
  return `只读：仅接粉负责人 ${name(row.ownerId)} 可编辑`;
 }
 function copyCells(e:React.ClipboardEvent){
  if(combined||!selection||!payload||editing)return;
  const {row,column,endRow,endColumn}=selection;
  if(payload.rows.slice(Math.min(row,endRow),Math.max(row,endRow)+1).some(r=>!dateOpen(rowDate(r.data,trash?null:view)))){e.preventDefault();setError("请先展开所选日期，再复制多格内容。");return;}
  const text=payload.rows.slice(Math.min(row,endRow),Math.max(row,endRow)+1).map(r=>columns.slice(Math.min(column,endColumn),Math.max(column,endColumn)+1).map(c=>{
   const value=display(c.id,cellValue(r,c.id));return /[\t\n\r"]/.test(value)?'"'+value.replaceAll('"','""')+'"':value==="—"?"":value;
  }).join("\t")).join("\n");e.preventDefault();e.clipboardData.setData("text/plain",text);
 }
 function pasteCells(e:React.ClipboardEvent){
  const text=e.clipboardData.getData("text/plain");
  if(!selection||!payload||busy||(!text.includes("\t")&&!text.includes("\n")))return;
  e.preventDefault();setError("");
  if(combined){setError("多格粘贴请先切换到逐列模式，避免填错字段。");return;}
  try{
   if(text.length>100000)throw new Error("一次粘贴内容过多，请分批操作");
   const matrix=parseSheetText(text,"\t");
   if(!matrix.length||matrix.length>50)throw new Error("一次最多粘贴50行");
   const updates=matrix.map((cells,i)=>{
    const row=payload.rows[selection.row+i];if(!row)throw new Error("粘贴超出当前页，请用导入客户新增名单");
    if(!dateOpen(rowDate(row.data,trash?null:view)))throw new Error("请先展开目标日期，再粘贴多格内容。");
    const values:SheetData={};cells.forEach((cell,j)=>{
     const column=columns[selection.column+j];if(!column)throw new Error("粘贴超出表格列数");
     if(!row.editable.includes(column.id))throw new Error(`${row.phone} 的${column.name}只读，本次没有保存任何内容`);
     values[column.id]=cell||null;
    });return {id:row.id,version:row.version,values};
   });setPasteUpdates(updates);setEditing(null);setModal("paste");
  }catch(error){setError((error as Error).message);}
 }
 const bundles=sheetLayout(view,expertStage).map(g=>({...g,fields:g.ids.flatMap(id=>columns.filter(c=>c.id===id))})).filter(g=>g.fields.length);
 const mainIds=new Set(bundles.flatMap(g=>g.ids));
 const detailColumns=columns.filter(c=>!mainIds.has(c.id));
 function groupedField(c:Column,row?:SheetRow){
  const value=row?cellValue(row,c.id):newRow[c.id];
  if(row&&c.id==="investmentTotal")return <div className={styles.groupedField} data-field={c.id} key={c.id}><span className={styles.fieldLabel}>{c.name}</span><div className={styles.fieldValue}><button className={styles.investmentButton} title={row.editable.includes(c.id)?"查看或维护资金流水":readOnlyReason(row,c)} onClick={()=>{setEditing(null);setInvestmentRow(row);}}>{Number(value||0).toLocaleString("en-US",{minimumFractionDigits:2})}<small>{row.editable.includes(c.id)?"查看 / 资金流水":"查看流水 · 只读"}</small></button></div></div>;
  return <div className={styles.groupedField} data-field={c.id} key={c.id}><span className={styles.fieldLabel}>{c.name}</span><div className={styles.fieldValue}>{row?<InlineSheetCell maxDate={actualDateFields.includes(c.id)?payload?.today:undefined} blockedReason={c.id==="joinedOn"&&!row.data.joinedOn&&row.data.replied!==true?"请先勾选已回复":undefined} readOnlyReason={readOnlyReason(row,c)} column={c} value={value} label={`${row.phone}-${c.name}${row.editable.includes(c.id)?"，可编辑":"，只读"}`} text={display(c.id,value)} allowed={row.editable.includes(c.id)} active={editing?.row.id===row.id&&editing.column.id===c.id} disabled={busy}
   renderInput={(v,onChange)=>input(c,v,onChange,true)} onSave={v=>saveCell(row,c,v)} onClose={()=>setEditing(current=>current?.row.id===row.id&&current.column.id===c.id?null:current)}
   onActivate={()=>{sequence.current++;setSelection(null);setEditing({row,column:c});setError("");}}/>:
   ["status","expertStatus"].includes(c.id)?<span className={styles.badge}>{c.id==="expertStatus"?customerExpertStatus(newRow):customerGroupStatus(newRow)}</span>:
   (c.stage==="expert"&&(!payload?.members.find(m=>m.id===payload.actorId)?.roles.includes("EXPERT")||newRow.expertId!==payload?.actorId))?<span>需指定本人为专家负责人</span>:!payload?.canChooseHistoricalOwner&&c.id==="ownerId"?<span>{display(c.id,value)}</span>:<fieldset disabled={busy}>{input(c,value,v=>setNewRow(r=>({...r,[c.id]:v})),c.id==="phone")}</fieldset>}{row&&fieldActionNumber(row.data,c.id)&&<small className={styles.actionNumber}>{fieldActionNumber(row.data,c.id)}</small>}</div></div>;
 }
 function rowActions(row:SheetRow){return row.canManage?<button type="button" className={styles.trashButton} aria-label={`${row.phone} 删除选项`} title="删除选项" disabled={busy||cellSaves>0} onClick={()=>{setEditing(null);setError("");setDeletionRow(row);}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>:null;}
 async function deleteCustomer(action:"archive"|"restore"|"permanent"){
  if(!deletionRow)return;
  const row=deletionRow;
  await perform(async()=>{
   const body=action==="permanent"?{version:row.version,action:"permanent"}:{version:row.version,deleted:action==="archive"};
   await api(`/api/customer-sheet/rows/${row.id}/deletion`,json("POST",body));
   setDeletionRow(null);setInvestmentRow(null);setExpandedRows(ids=>ids.filter(id=>id!==row.id));
   window.dispatchEvent(new Event("ai-data-updated"));
  },false);
 }

 function openImport(){setError("");setModal("import");}
 const emptyContent=<div><p>当前范围暂无客户</p><button disabled={busy||cellSaves>0} onClick={()=>setFindOpen(true)}>跨进度找号码</button><button onClick={()=>{setQ("");setStatus("");setDateRange("all");setDateFrom("");setDateTo("");setExpertStage("全部");setMine(false);scopeChange();}}>清除筛选</button>{payload?.canCreate&&!trash&&<button onClick={openImport}>导入名单</button>}</div>;
 const scopeChange=()=>{setFocusId(null);scrolledFocus.current="";setDateExpansion({});setPage(1);setError("");setEditing(null);setSelection(null);};
 const navigationBusy=busy||cellSaves>0||addingRow||!!editing;
 function changePage(next:number){if(navigationBusy||!payload)return;sequence.current++;setFocusId(null);scrolledFocus.current="";setSelection(null);setEditing(null);setDateExpansion({});setPage(next);sheetScroll.current?.scrollTo({top:0});}
 function openLocatedCustomer(row:CustomerLocation){sequence.current++;setFindOpen(false);setShowStatistics(false);setError("");setSaved("");setEditing(null);setSelection(null);setPayload(null);setView(row.stage);setTrash(row.deleted);setPage(row.page);setMine(true);setResponsibility("owner");setAssignee(row.ownerId===payload?.actorId?"me":row.ownerId);setQ("");setStatus("");setExpertStage("全部");setDateRange("all");setDateFrom("");setDateTo("");setDateExpansion({[row.date]:true});scrolledFocus.current="";setFocusId(row.id);void (focusId===row.id&&load());}
 const pagination=(position:"顶部"|"底部")=>payload?<CustomerPagination position={position} total={payload.total} page={payload.page} pages={payload.pages} disabled={navigationBusy} onPage={changePage}/>:<div className={styles.pagination}>正在读取页码…</div>;
 const dates=[...new Set((payload?.rows||[]).map(r=>rowDate(r.data,trash?null:view)))];
 const dateOpen=(date:string)=>dateExpansion[date]??date===dates[0];
 function dateHeading(row:SheetRow,index:number,span:number){
  const date=rowDate(row.data,trash?null:view);if(index>0&&date===rowDate(payload!.rows[index-1].data,trash?null:view))return null;
  const count=payload?.dateCounts?.[date]??payload!.rows.filter(r=>rowDate(r.data,trash?null:view)===date).length;
  const onPage=payload!.rows.filter(r=>rowDate(r.data,trash?null:view)===date).length;
  return <tr className={styles.dateGroup}><td colSpan={span}><button aria-expanded={dateOpen(date)} onClick={()=>{setFocusId(null);setSelection(null);setEditing(null);setDateExpansion(v=>({...v,[date]:!dateOpen(date)}));}}>{dateOpen(date)?"▾":"▸"} {date?`${date.slice(0,4)}年${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`:trash?"未记录进群日期":"待补日期"} · {count}人{onPage<count?`（本页${onPage}人）`:""}</button></td></tr>;
 }
 function changeView(nextView:"pending"|"group"|"expert"){
  setTrash(false);setShowStatistics(false);setView(nextView);setResponsibility("owner");setAssignee("me");setMine(initialMine);setStatus(nextView==="group"?"正常在群":"");scopeChange();
 }
 function draftCell(column:Column){
  if(["status","expertStatus"].includes(column.id))return <span className={styles.badge}>{column.id==="expertStatus"?customerExpertStatus(newRow):customerGroupStatus(newRow)}</span>;
  if(column.stage==="expert"&&(!payload?.members.find(member=>member.id===payload.actorId)?.roles.includes("EXPERT")||newRow.expertId!==payload?.actorId))return <span>需指定本人为专家负责人</span>;
  if(!payload?.canChooseHistoricalOwner&&column.id==="ownerId")return <span className={styles.cellText}>{display(column.id,newRow[column.id])}</span>;
  return <fieldset disabled={busy}>{input(column,newRow[column.id],value=>setNewRow(row=>({...row,[column.id]:value})),column.id==="phone")}</fieldset>;
 }
 function gridCell(row:SheetRow,column:Column,rowIndex:number,columnIndex:number){
  const value=cellValue(row,column.id);const allowed=row.editable.includes(column.id);const active=editing?.row.id===row.id&&editing.column.id===column.id;
  return <>{column.id==="investmentTotal"?<button className={styles.investmentButton} title={allowed?"查看或维护资金流水":readOnlyReason(row,column)} onClick={()=>{setEditing(null);setInvestmentRow(row);}}>{display(column.id,value)}<small>{allowed?"查看 / 资金流水":"查看流水 · 只读"}</small></button>:<InlineSheetCell maxDate={actualDateFields.includes(column.id)?payload?.today:undefined} blockedReason={column.id==="joinedOn"&&!row.data.joinedOn&&row.data.replied!==true?"请先勾选已回复":undefined} readOnlyReason={readOnlyReason(row,column)} column={column} value={value} label={`${row.phone}-${column.name}${allowed?"，可编辑":"，只读"}`} text={display(column.id,value)} allowed={allowed} active={active} disabled={busy}
   renderInput={(nextValue,onChange)=>input(column,nextValue,onChange,true)} onSave={nextValue=>saveCell(row,column,nextValue)} onClose={()=>setEditing(current=>current?.row.id===row.id&&current.column.id===column.id?null:current)}
   onActivate={event=>{sequence.current++;if(event.shiftKey&&selection){setEditing(null);setSelection({...selection,endRow:rowIndex,endColumn:columnIndex});return;}setSelection({row:rowIndex,column:columnIndex,endRow:rowIndex,endColumn:columnIndex});setEditing({row,column});setError("");}} />}
   {fieldActionNumber(row.data,column.id)&&<small className={styles.actionNumber}>{fieldActionNumber(row.data,column.id)}</small>}</>;
 }
 if(!groupId)return <div className={styles.root}>请选择一个小组查看客户。</div>;
 return <section className={styles.root} data-roomy={roomy} data-combined={combined}>
  <CustomerSheetToolbar groups={groups} groupId={groupId} addingRow={addingRow} busy={busy} cellSaves={cellSaves} view={view} showStatistics={showStatistics} responsibility={responsibility} assignee={assignee} mine={mine} members={payload?.members||[]} actorId={payload?.actorId} referenceNames={payload?.referenceNames} trash={trash} query={q} navigationBusy={navigationBusy} payloadReady={!!payload} status={status} statusOptions={view==="expert"?expertStatuses:["待跟进","正常在群","正常退群","异常退群"]} canConfigure={!!payload?.canConfigure} canCreate={!!payload?.canCreate} combined={combined} roomy={roomy}
   onView={changeView} onStatistics={()=>setShowStatistics(true)} onGroup={value=>{setGroupId(value);scopeChange();}} onResponsibility={value=>{setResponsibility(value);setMine(true);setAssignee("me");scopeChange();}} onAssignee={value=>{setMine(value!=="all");setAssignee(value);scopeChange();}} onTrash={()=>{setTrash(value=>!value);setShowStatistics(false);setQ("");setMine(false);scopeChange();}} onQuery={value=>{setQ(value);scopeChange();}} onFind={()=>setFindOpen(true)} onStatus={value=>{setStatus(value);if(["暂停跟进","已结束"].includes(value))setExpertStage("全部");scopeChange();}} onColumns={()=>{setError("");setModal("columns");}} onCombined={()=>{setCombined(value=>!value);setEditing(null);setSelection(null);}} onRoomy={()=>setRoomy(value=>!value)} onImport={openImport} onNew={openNew}/>
  {showStatistics?<NumberStatistics groupId={groupId}/>:<>
  {!trash&&<CustomerDateToolbar label={viewLabel(view)} range={dateRange} from={dateFrom} to={dateTo} today={payload?.today} combined={combined} disabled={addingRow||busy} onRange={(range,date)=>{setDateRange(range);setDateFrom(date);setDateTo(date);scopeChange();}} onFrom={value=>{setDateFrom(value);scopeChange();}} onTo={value=>{setDateTo(value);scopeChange();}} onExpand={()=>setDateExpansion(Object.fromEntries(dates.map(date=>[date,true])))} onCollapse={()=>{setFocusId(null);setEditing(null);setSelection(null);setDateExpansion(Object.fromEntries(dates.map(date=>[date,false])));}}/>}
  {trash&&<p role="status">已删除客户（全部阶段）。恢复后按原日期重新计入黑客组统计；律师组手填日报不变。</p>}
  {!trash&&view==="pending"&&<div className={styles.draftBar}>导入时记录接粉日期和渠道；号码情况、回复、后续进度及资金按发生日期自动汇总。</div>}
  {!trash&&view==="expert"&&<nav className={styles.expertTabs} aria-label="专家阶段">{expertStages.map(s=><button key={s} data-active={expertStage===s} onClick={()=>{setExpertStage(s);setStatus("");scopeChange();}}>{s} <span>{payload?.expertCounts?.[s]??"—"}</span></button>)}</nav>}
  {saved&&<div role="status" className={styles.importSuccess}>{saved}</div>}
  {addingRow&&<div className={styles.draftBar}><span>新客户：直接填写下方空白行，客户号码必填，其余可留空。</span><button className={styles.primary} disabled={busy} onClick={()=>void saveNewRow()}>{busy?"保存中…":"保存新行"}</button><button disabled={busy} onClick={()=>{setAddingRow(false);setNewRow({});setError("");}}>取消新增</button></div>}
  {error&&<div className={styles.error} role="alert">{error}<button onClick={()=>{setEditing(null);setError("");void load();}}>刷新</button></div>}
  {focusId&&payload?.focus&&<div className={styles.locatedNotice} role="status">已定位到{payload.focus.deleted?"删除归档":customerStageNames[payload.focus.stage]} · 第 {payload.page} 页。已展开日期并标出客户。<button onClick={()=>setFocusId(null)}>退出定位</button></div>}
  {pagination("顶部")}
  <CustomerSheetTable payload={payload} combined={combined} addingRow={addingRow} focusId={focusId} sheetScroll={sheetScroll} focusedRow={focusedRow} bundles={bundles} columns={columns} detailColumns={detailColumns} expandedRows={expandedRows} selection={selection} editing={editing} emptyContent={emptyContent} renderGroupedField={groupedField} renderDateHeading={dateHeading} renderRowActions={rowActions} renderDraftCell={draftCell} renderGridCell={gridCell} isDateOpen={row=>dateOpen(rowDate(row.data,trash?null:view))} onToggleExpanded={rowId=>setExpandedRows(ids=>ids.includes(rowId)?ids.filter(id=>id!==rowId):[...ids,rowId])} onCopy={copyCells} onPaste={pasteCells}/>

  <footer className={styles.footer}><span>{payload?.groupName} · 共 {payload?.total??0} 位客户 · {saved||"他人内容只读"} · 黑客组自动统计 · 律师组手填日报</span><span>{combined?"点击铅笔原地填写 · 更多字段在行内展开":"点击查看 / 编辑 · Shift 点选范围可复制 · 支持多格粘贴"}</span>{pagination("底部")}</footer>
  </>}
  {findOpen&&payload&&<CustomerFinder groupId={groupId} groupName={payload.groupName} initialQuery={q} onClose={()=>setFindOpen(false)} onOpen={openLocatedCustomer}/>}
  {deletionRow&&<div className={styles.overlay}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label="删除选项"><h3>{deletionRow.data.__deletedAt?"已归档客户":"删除客户"}</h3><p>客户号码：{deletionRow.phone}</p><p>接粉编号：{fieldActionNumber(deletionRow.data,"intakeOn")||"未生成"}</p><p>{deletionRow.data.__deletedAt?"恢复后可继续跟进，按原日期恢复号码统计。":"删除归档：移入已删除列表，以后可以恢复。"}</p><p><strong>永久删除：</strong>清除这位客户的资料、资金明细和修改记录，无法在系统内恢复。</p><p>号码统计会同步更新，不会重复扣减；律师组手填日报不变。</p>{error&&<p role="alert">{error}</p>}<footer><button autoFocus disabled={busy} onClick={()=>{setDeletionRow(null);setError("");}}>取消</button><button disabled={busy||cellSaves>0} onClick={()=>void deleteCustomer(deletionRow.data.__deletedAt?"restore":"archive")}>{deletionRow.data.__deletedAt?"恢复客户":"删除归档"}</button><button className={styles.permanentDelete} disabled={busy||cellSaves>0} onClick={()=>void deleteCustomer("permanent")}>{busy?"处理中…":"永久删除"}</button></footer></section></div>}

  {investmentRow&&<InvestmentDialog row={investmentRow} readOnlyReason={readOnlyReason(investmentRow,payload!.columns.find(column=>column.id==="investmentTotal")!)} onClose={()=>setInvestmentRow(null)} onSaved={load}/>}
  {modal&&payload&&<div className={styles.overlay}><section className={`${styles.dialog} ${modal==="import"?styles.wide:""}`} role="dialog" aria-modal="true" aria-label={modal==="import"?(view==="pending"?"导入客户号码":"导入客户"):modal==="columns"?"表格列设置":"确认粘贴"}>
   <header><h3>{modal==="import"?(view==="pending"?"导入客户号码":"导入客户"):modal==="columns"?"表格列设置":"确认粘贴"}</h3><button aria-label="关闭弹窗" disabled={busy} onClick={()=>{setModal(null);setError("");}}>×</button></header>
   {error&&<div className={styles.error} role="alert">{error}</div>}
   {modal==="import"&&<CustomerImportWizard payload={payload} initialStage={view} onSaved={()=>{setSaved("导入已保存，已同步日报");void load();}} onBusy={setBusy}/>}
   {modal==="columns"&&<><p>勾选需要显示的列，设置只影响当前页面。</p><div className={styles.checkGrid}>{availableColumns.map(c=><label key={c.id}><input type="checkbox" disabled={["phone","status","expertStatus"].includes(c.id)} checked={["phone","status","expertStatus"].includes(c.id)||!hidden.includes(c.id)} onChange={e=>setHidden(h=>e.target.checked?h.filter(k=>k!==c.id):[...h,c.id])}/>{c.name}</label>)}</div>{payload.canConfigure?<><h4>新增全组自定义列</h4><div className={styles.formGrid}><label>列名<input aria-label="新列名称" value={columnDraft.name} onChange={e=>setColumnDraft(c=>({...c,name:e.target.value}))}/></label><label>类型<select value={columnDraft.kind} onChange={e=>setColumnDraft(c=>({...c,kind:e.target.value}))}>{[['text','文字'],['number','数字'],['date','日期'],['boolean','勾选'],['select','下拉选项']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>显示位置<select value={columnDraft.stage} onChange={e=>setColumnDraft(c=>({...c,stage:e.target.value}))}><option value="group">在群跟进</option><option value="expert">专家跟进</option></select></label>{columnDraft.kind==="select"&&<label>选项（每行一个）<textarea value={columnDraft.options} onChange={e=>setColumnDraft(c=>({...c,options:e.target.value}))}/></label>}</div><footer><button className={styles.primary} disabled={busy||!columnDraft.name.trim()} onClick={()=>perform(()=>api("/api/customer-sheet/columns",json("POST",{...columnDraft,groupId,options:columnDraft.options.split('\n').map(s=>s.trim()).filter(Boolean)})))}>添加列</button></footer></>:<p>新增自定义列由本组组长统一管理。</p>}</>}
   {modal==="paste"&&<><p>将更新 {pasteUpdates.length} 位客户。核对号码后整批保存，按日期同步日报。</p><div className={styles.preview}><table><thead><tr><th>客户号码</th><th>字段</th><th>原值 → 新值</th></tr></thead><tbody>{pasteUpdates.flatMap(update=>Object.entries(update.values).map(([key,value])=>{const row=payload.rows.find(r=>r.id===update.id)!;return <tr key={update.id+key}><td>{row.phone}</td><td>{columns.find(c=>c.id===key)?.name}</td><td>{display(key,cellValue(row,key))} → {display(key,value)}</td></tr>;}))}</tbody></table></div><footer><button disabled={busy} className={styles.primary} onClick={()=>perform(()=>api("/api/customer-sheet/rows/batch",json("PATCH",{rows:pasteUpdates})))}>确认保存粘贴内容</button></footer></>}
  </section></div>}
 </section>;
}
