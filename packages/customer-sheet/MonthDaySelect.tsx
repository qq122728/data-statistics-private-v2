"use client";
import CalendarDateInput from './CalendarDateInput';
import styles from "./MonthDaySelect.module.css";
// Keep the existing date-value API; all callers now use the same native calendar.
export default function MonthDaySelect({value,onChange,label,disabled=false,max,clearable=true,autoFocus=false,onClear}:{value:string;onChange:(value:string)=>void;label:string;disabled?:boolean;max?:string;clearable?:boolean;autoFocus?:boolean;onClear?:()=>void}){
 return <span className={styles.control} role="group" aria-label={label}>
  <CalendarDateInput autoFocus={autoFocus} aria-label={label} disabled={disabled} value={value.slice(0,10)} max={max} onChange={event=>onChange(event.target.value)}/>
  {clearable&&value&&<button type="button" aria-label={`清空${label}`} disabled={disabled} onClick={()=>onClear?onClear():onChange("")}>×</button>}
 </span>;
}
