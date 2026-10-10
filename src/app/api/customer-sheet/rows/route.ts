import { createSheetRows } from "../../../../lib/customer-sheet";
import { sheetHttp } from "../../../../lib/customer-sheet-http";
export async function POST(request: Request) { return sheetHttp(async id => ({ ids: await createSheetRows(id,await request.json()) })); }
