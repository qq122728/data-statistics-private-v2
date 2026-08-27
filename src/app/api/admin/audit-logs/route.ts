import { NextResponse } from "next/server";
import { db } from "../../../../lib/db";
import { localDateFilterBounds } from "../../../../lib/dates";
import { getSystemSettings } from "../../../../lib/settings";
import { requireAdminRequest } from "../_auth";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";

export async function GET(request: Request) {
  const access = await requireAdminRequest(); if ("response" in access) return access.response;
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const from = params.get("from"); const to = params.get("to"); const actorId = params.get("actorId"); const action = params.get("action");
  const settings = await getSystemSettings();
  const createdAt = localDateFilterBounds(from, to, settings.timezone);
  const logs = await db.auditLog.findMany({
    where: { ...(actorId ? { actorId } : {}), ...(action ? { action } : {}), ...(Object.keys(createdAt).length ? { createdAt } : {}) },
    include: { actor: { select: { id: true, name: true, username: true } } }, orderBy: { createdAt: "desc" }, take: 300,
  });
  return NextResponse.json(logs);
}
