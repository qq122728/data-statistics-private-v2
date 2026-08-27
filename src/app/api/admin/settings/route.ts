import { NextResponse } from "next/server";
import { getSystemSettings, updateSystemSettings } from "../../../../lib/settings";
import { requireAdminRequest } from "../_auth";

export async function GET() {
  const access = await requireAdminRequest(); if ("response" in access) return access.response;
  return NextResponse.json(await getSystemSettings());
}

export async function PATCH(request: Request) {
  const access = await requireAdminRequest(); if ("response" in access) return access.response;
  try { return NextResponse.json(await updateSystemSettings(await request.json(), access.actor.id)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "设置参数不正确" }, { status: 400 }); }
}
