import { patchSheetRow } from "../../../../../lib/customer-sheet";
import { sheetHttp } from "../../../../../lib/customer-sheet-http";
export async function PATCH(request: Request, context: { params: Promise<{id:string}> }) { return sheetHttp(async actorId => patchSheetRow(actorId,(await context.params).id,await request.json())); }
