"use client";
import { useState } from "react";

// Keep typing text separate from the numeric value used for totals and saving.
export default function DailyNumberInput({value,money,label,onChange,onEditing}:{value:number;money:boolean;label:string;onChange:(value:number)=>void;onEditing:(editing:boolean)=>void}){
 const format=(n:number)=>money?n.toFixed(2):String(Math.round(n));
 const [draft,setDraft]=useState("");
 const [editing,setEditing]=useState(false);
 return <input aria-label={label} type="number" min="0" step={money?"0.01":"1"} value={editing?draft:format(value)}
  onFocus={e=>{setDraft(format(value));setEditing(true);onEditing(true);if(value===0)e.currentTarget.select();}}
  onChange={e=>{const raw=e.target.value;setDraft(raw);if(raw!==""&&Number.isFinite(Number(raw))&&Number(raw)>=0)onChange(Number(raw));}}
  onBlur={()=>{if(draft==="")onChange(0);setEditing(false);onEditing(false);}}
  onKeyDown={e=>{
   if(e.key!=="Enter"||e.nativeEvent.isComposing)return;
   e.preventDefault();
   const cell=e.currentTarget.closest("td");let row=e.currentTarget.closest("tr");
   const index=cell?.cellIndex;
   while(row&&index!==undefined){row=(e.shiftKey?row.previousElementSibling:row.nextElementSibling) as HTMLTableRowElement|null;const next=row?.cells[index]?.querySelector("input");if(next){next.focus();next.select();return;}}
   e.currentTarget.blur();
  }}/>;
}
