import {sheetHttp} from "../../../../lib/customer-sheet-http";
import {sheetConversation} from "../../../../lib/sheet-conversation";
import {SheetError} from "../../../../lib/customer-sheet";
async function read(request:Request){const text=await request.text();if(text.length>6*1024*1024)throw new SheetError("内容过大，请分批发送",413);return JSON.parse(text);}
export async function POST(request:Request){return sheetHttp(async id=>sheetConversation(id,await read(request)));}
export async function PUT(request:Request){return sheetHttp(async id=>sheetConversation(id,await read(request),true));}
