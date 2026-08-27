import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  AuthenticationError,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  requireUser,
  SESSION_COOKIE,
  verifyPassword,
} from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, tooLargeResponse } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

type ChangePasswordRequest = {
  currentPassword?: unknown;
  newPassword?: unknown;
};

export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireUser({ allowPasswordChangeRequired: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });
    }
    throw error;
  }

  let body: ChangePasswordRequest;
  try {
    body = await readLimitedJson(request, API_LIMITS.loginBodyBytes) as ChangePasswordRequest;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
    return NextResponse.json({ error: "请填写当前密码和新密码" }, { status: 400 });
  }
  if (body.currentPassword.length > API_LIMITS.loginPasswordCharacters || body.newPassword.length > API_LIMITS.loginPasswordCharacters) {
    return NextResponse.json({ error: "密码长度超过限制" }, { status: 400 });
  }
  if (body.newPassword.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json({ error: `新密码至少需要 ${PASSWORD_MIN_LENGTH} 位` }, { status: 400 });
  }
  if (body.currentPassword === body.newPassword) {
    return NextResponse.json({ error: "新密码不能和当前密码相同" }, { status: 400 });
  }

  const result = await db.$transaction(async (client) => {
    const currentUser = await client.user.findUnique({
      where: { id: actor.id },
      select: { id: true, passwordHash: true },
    });
    if (!currentUser || !verifyPassword(body.currentPassword as string, currentUser.passwordHash)) {
      return { error: "当前密码不正确", status: 403 as const };
    }

    await client.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: hashPassword(body.newPassword as string),
        mustChangePassword: false,
      },
    });
    await client.session.deleteMany({ where: { userId: actor.id } });
    await recordAudit(client, {
      actorId: actor.id,
      action: "SELF_PASSWORD_CHANGED",
      entityType: "User",
      entityId: actor.id,
      summary: { changedFields: ["password"], selfService: true },
    });
    return { ok: true };
  });

  if ("error" in result) {
    return result.status === 403 ? authorizationDenied(actor, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}
