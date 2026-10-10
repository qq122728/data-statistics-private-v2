import { findSheetCustomers } from "../../../../lib/customer-sheet-finder";
import { sheetHttp } from "../../../../lib/customer-sheet-http";

export async function GET(request: Request) {
  return sheetHttp(actorId => findSheetCustomers(actorId, new URL(request.url).searchParams));
}
