import { listSheet } from "../../../lib/customer-sheet";
import { sheetHttp } from "../../../lib/customer-sheet-http";
export async function GET(request: Request) { return sheetHttp(id => listSheet(id,new URL(request.url).searchParams)); }
