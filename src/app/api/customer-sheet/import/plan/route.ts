import { sheetHttp } from "../../../../../lib/customer-sheet-http";
import { planSheetImport } from "../../../../../lib/sheet-import-plan";
import { SheetError } from "../../../../../lib/customer-sheet";
async function run(request:Request,commit:boolean){return sheetHttp(async actor=>{const text=await request.text();if(text.length>6*1024*1024)throw new SheetError("导入内容过大，请分批处理",413);return planSheetImport(actor,JSON.parse(text),commit);});}
export async function POST(request:Request){return run(request,false);}
export async function PUT(request:Request){return run(request,true);}
