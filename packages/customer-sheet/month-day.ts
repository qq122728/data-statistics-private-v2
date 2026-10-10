// Dates keep their year in storage; the sheet only asks for month and day.
export function monthDay(value: unknown): string {
 const text=String(value??"");
 const full=/^\d{4}[-/](\d{2})[-/](\d{2})/.exec(text);
 return full?`${full[1]}/${full[2]}`:text;
}
export function expandMonthDay(text: string, previous?: unknown, now=new Date()): string {
 const match=/^(\d{1,2})\s*(?:[-/]|月)\s*(\d{1,2})日?$/.exec(text);
 if(!match)return text;
 const year=/^(\d{4})[-/]/.exec(String(previous??""))?.[1]??new Intl.DateTimeFormat("en",{timeZone:"Asia/Shanghai",year:"numeric"}).format(now);
 return `${year}-${match[1].padStart(2,"0")}-${match[2].padStart(2,"0")}`;
}
