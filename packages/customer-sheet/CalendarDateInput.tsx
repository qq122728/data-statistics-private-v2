"use client";
import type { InputHTMLAttributes } from 'react';
/** Use the browser calendar everywhere; an empty value opens the current month. */
export default function CalendarDateInput({onClick,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'type'>){
 return <input {...props} type="date" onClick={event=>{
  onClick?.(event);
  if(event.defaultPrevented||event.currentTarget.disabled||event.currentTarget.readOnly)return;
  try{event.currentTarget.showPicker();}catch{/* The native calendar icon and keyboard remain usable. */}
 }}/>;
}
