import { changeSheetRowDeletion, permanentlyDeleteSheetRow } from "../../../../../../lib/customer-sheet";
import { sheetHttp } from "../../../../../../lib/customer-sheet-http";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const {id:rowId}=await context.params;
 return sheetHttp(async actorId=>{const body=await request.json();return body?.action==="permanent"?permanentlyDeleteSheetRow(actorId,rowId,body):changeSheetRowDeletion(actorId,rowId,body);});
}
