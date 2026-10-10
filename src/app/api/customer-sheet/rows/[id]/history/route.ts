import { sheetHistory } from "../../../../../../lib/customer-sheet";
import { sheetHttp } from "../../../../../../lib/customer-sheet-http";
export async function GET(_request: Request, context: { params: Promise<{id:string}> }) { return sheetHttp(async actorId => ({ revisions: await sheetHistory(actorId,(await context.params).id) })); }
