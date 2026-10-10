import { createSheetColumn } from "../../../../lib/customer-sheet";
import { sheetHttp } from "../../../../lib/customer-sheet-http";
export async function POST(request: Request) { return sheetHttp(async id => ({ column: await createSheetColumn(id,await request.json()) })); }
