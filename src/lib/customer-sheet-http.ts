import { isKnownPrismaError } from "./prisma-errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireUser } from "./auth";
import { SheetError } from "./customer-sheet";
import { authorizationDenied } from "./security-events";
export async function sheetHttp(action: (actorId: string) => Promise<unknown>) {
  let actor: Awaited<ReturnType<typeof requireUser>> | undefined;
  try {
    actor = await requireUser();
    const result=await action(actor.id);
    return result instanceof Response ? result : NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch(e) {
    const status=e instanceof AuthenticationError ? 401 : e instanceof AuthorizationError ? 403 : e instanceof SheetError ? e.status : e instanceof z.ZodError || e instanceof SyntaxError ? 400 : isKnownPrismaError(e) && e.code === "P2002" ? 409 : 500;
    const message=e instanceof z.ZodError ? e.issues[0]?.message : status===409 && !(e instanceof SheetError) ? "记录已存在或已被修改，请刷新后重试" : status===500 ? "操作未完成，请重试" : (e as Error).message;
    if(status===500) console.error("Customer sheet request failed",e);
    if(status===403&&actor)return authorizationDenied(actor,message||"没有权限执行此操作");
    const responseStatus=status===400?400:status===401?401:status===404?404:status===409?409:status===413?413:500;
    return NextResponse.json({error:message},{status:responseStatus});
  }
}
