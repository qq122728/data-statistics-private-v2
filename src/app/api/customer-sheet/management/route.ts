import { sheetHttp } from "../../../../lib/customer-sheet-http";
import { managementCustomerProgress } from "../../../../lib/management-customer-progress";

export async function GET(request: Request) {
  return sheetHttp(actorId => managementCustomerProgress(actorId, new URL(request.url).searchParams));
}
