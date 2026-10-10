"use client";
import { useRef, useState, type ReactNode, type MouseEvent } from "react";
import type { CellValue, Column } from "./schema";
import MonthDaySelect from "./MonthDaySelect";
import styles from "./CustomerSheet.module.css";

type Props = {
 column: Column; value: CellValue | undefined; label: string; text: string;
 maxDate?: string;
 blockedReason?: string;
 readOnlyReason?: string;
 allowed: boolean; active: boolean; disabled: boolean;
 onActivate: (event: MouseEvent<HTMLButtonElement>) => void;
 onClose: () => void;
 onSave: (value: CellValue) => Promise<void>;
 renderInput: (value: CellValue, onChange: (value: CellValue) => void) => ReactNode;
};
export default function InlineSheetCell(p: Props) {
 const [draft,setDraft]=useState<CellValue>(p.value??"");
 const [dateDirty,setDateDirty]=useState(false);
 const [pending,setPending]=useState(false);
 const [failure,setFailure]=useState("");
 const submitted=useRef(false);
 const pasteInProgress=useRef(false);
 const active=p.active||!!failure||pending;
 async function save(value:CellValue=draft){
  if(submitted.current||!p.allowed||pasteInProgress.current)return;
  submitted.current=true;
  if(String(value??"")===String(p.value??"")){setDateDirty(false);setFailure("");p.onClose();return;}
  setPending(true);setFailure("");
  try{await p.onSave(value);setDateDirty(false);p.onClose();}
  catch(e){setFailure((e as Error).message);}
  finally{setPending(false);}
 }
 function change(value:CellValue){setDraft(value);submitted.current=false;}
 if(["status","expertStatus"].includes(p.column.id))return <span className={styles.automaticStatus} title={p.column.id==="expertStatus"?"根据专家进度自动判断；暂停或结束请修改跟进安排":"根据正常或异常退群勾选和进群日期自动判断"}><span className={styles.badge} data-state={String(p.value)}>{p.text}</span></span>;
 if(p.blockedReason&&p.allowed)return <span className={styles.inlineHint}>{p.blockedReason}</span>;
 if(p.column.kind==="boolean")return <div className={styles.inlineCheck}>
  <input type="checkbox" aria-label={p.label} checked={pending?draft===true:p.value===true} disabled={!p.allowed||p.disabled||pending} onChange={e=>{change(e.target.checked);void save(e.target.checked);}} />
  {p.allowed&&<i aria-hidden="true">✎</i>}{failure&&<span role="alert" className={styles.inlineError}>{failure}</span>}
 </div>;
 if(["date","datetime"].includes(p.column.kind)&&p.allowed)return <div className={styles.inlineDate}
  onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)&&dateDirty){const field=event.currentTarget.querySelector("input");if(field&&!field.validity.valid){setFailure(p.maxDate?`请选择完整日期，最晚为 ${p.maxDate}（系统统计日）`:"请选择完整有效的日期");return;}void save(draft);}}}
  onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();setDraft(p.value??"");setDateDirty(false);setFailure("");submitted.current=false;}if(event.key==="Enter"){event.preventDefault();const field=event.currentTarget.querySelector("input");if(dateDirty&&field?.checkValidity())void save(draft);}}}>
  <MonthDaySelect label={p.label} value={String(dateDirty||pending||failure?draft:p.value??"")} max={p.maxDate} disabled={p.disabled||pending} onClear={()=>{change("");void save("");}} onChange={value=>{change(value);setDateDirty(true);}}/>
  {pending&&<span className={styles.inlineHint}>保存中</span>}
  {failure&&<span role="alert" className={styles.inlineError}>{failure}；尚未保存，可修改后重试或按 Esc 恢复。</span>}
 </div>;
 if(active)return <div className={styles.inlineEditor}
  onPaste={e=>{const t=e.clipboardData.getData("text/plain");if(t.includes("\t")||t.includes("\n")){pasteInProgress.current=true;queueMicrotask(()=>{pasteInProgress.current=false;});}}}
  onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null)){if(p.allowed)void save();else p.onClose();}}}
  onKeyDown={e=>{
   if(e.nativeEvent.isComposing)return;
   if(e.key==="Escape"){e.preventDefault();submitted.current=true;setFailure("");setDraft(p.value??"");p.onClose();}
   if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void save();}
  }}>
  {p.allowed?<fieldset disabled={p.disabled||pending}>{p.renderInput(draft,change)}</fieldset>:<><button className={styles.expandedText} onClick={p.onClose}>{p.text}</button>{p.readOnlyReason&&<span className={styles.inlineHint}>{p.readOnlyReason}</span>}</>}
  {pending&&<span className={styles.inlineHint}>保存中</span>}
  {failure&&<span role="alert" className={styles.inlineError}>{failure}（修改后重试，Esc取消）</span>}
 </div>;
 return <button className={styles.cell} disabled={p.disabled} aria-label={p.label} title={`${p.text} · ${p.allowed?"点击原地填写":p.readOnlyReason||"只读，点击展开"}`}
  onClick={e=>{if(!e.shiftKey){setDraft(p.value??"");setFailure("");submitted.current=false;}p.onActivate(e);}}>
  <span className={p.column.id==="status"?styles.badge:styles.cellText} data-state={p.column.id==="status"?String(p.value):undefined}>{p.text}</span>
  {p.allowed&&<i aria-hidden="true">✎</i>}
 </button>;
}
