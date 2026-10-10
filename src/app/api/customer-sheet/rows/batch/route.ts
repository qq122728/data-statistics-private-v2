import { patchSheetRows } from "../../../../../lib/customer-sheet";
import { sheetHttp } from "../../../../../lib/customer-sheet-http";
export async function PATCH(request: Request) {
  return sheetHttp(async actorId => patchSheetRows(actorId, await request.json()));
}
