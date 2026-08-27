import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession, SESSION_COOKIE } from "../../../../lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  await deleteSession(cookieStore.get(SESSION_COOKIE)?.value);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}
