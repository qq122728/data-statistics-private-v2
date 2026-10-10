import { addSheetRecharge, deleteSheetRecharge } from "../../../../../../lib/customer-sheet";
import { sheetHttp } from "../../../../../../lib/customer-sheet-http";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 return sheetHttp(async actorId=>addSheetRecharge(actorId,(await context.params).id,await request.json()));
}
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){
 return sheetHttp(async actorId=>deleteSheetRecharge(actorId,(await context.params).id,await request.json()));
}
