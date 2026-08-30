import { NextResponse } from "next/server";
import {
  authenticateUserWithIdentity,
  createSession,
  sessionCookie,
  SESSION_COOKIE,
} from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import {
  loginRetryAfterMs,
  loginAuditIdentity,
  recordFailedLogin,
  recordSuccessfulLogin,
} from "../../../../lib/login-throttle";
import { API_LIMITS, RequestBodyTooLargeError, readLimitedJson, tooLargeResponse } from "../../../../lib/request-limits";
import { recordSecurityEvent } from "../../../../lib/security-events";
import { workspaceForUser } from "../../../../lib/workspace-routing";

type LoginRequest = {
  username?: unknown;
  password?: unknown;
};

function clientIp(request: Request): string {
  const value = request.headers.get("x-real-ip")?.trim();
  // 应用仅监听 127.0.0.1；生产 Nginx 会把此头覆盖为真实来源 IP。
  return value && value.length <= 64 ? value : "unknown";
}

function retryAfterSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

export async function POST(request: Request) {
  let body: LoginRequest;
  try {
    body = await readLimitedJson(request, API_LIMITS.loginBodyBytes) as LoginRequest;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  if (typeof body.username !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "请填写账号和密码" }, { status: 400 });
  }
  if (body.username.length > API_LIMITS.loginUsernameCharacters || body.password.length > API_LIMITS.loginPasswordCharacters) {
    return NextResponse.json({ error: "账号或密码长度超过限制" }, { status: 400 });
  }

  const identity = {
    ip: clientIp(request),
    // 原样保存，避免改变当前用户名大小写敏感的登录语义。
    username: body.username.trim().slice(0, 200),
  };
  const retryAfter = loginRetryAfterMs(identity);
  if (retryAfter > 0) {
    const auditIdentity = loginAuditIdentity(identity);
    recordSecurityEvent({
      event: "LOGIN_LOCKED",
      userId: auditIdentity?.userId ?? null,
      teamId: auditIdentity?.teamId ?? null,
      result: "locked",
    });
    const seconds = retryAfterSeconds(retryAfter);
    return NextResponse.json(
      { error: "登录尝试过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(seconds) } },
    );
  }

  const authentication = await authenticateUserWithIdentity(body.username, body.password);
  const user = authentication.user;
  if (!user) {
    recordFailedLogin(identity, Date.now(), authentication.auditIdentity);
    recordSecurityEvent({
      event: "LOGIN_FAILURE",
      userId: authentication.auditIdentity?.userId ?? null,
      teamId: authentication.auditIdentity?.teamId ?? null,
      result: "failure",
    });
    return NextResponse.json({ error: "账号、密码错误或账号已停用" }, { status: 401 });
  }

  recordSuccessfulLogin(identity);

  const [session] = await Promise.all([
    createSession(user.id),
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);
  recordSecurityEvent({
    event: "LOGIN_SUCCESS",
    userId: user.id,
    teamId: user.groupId,
    result: "success",
  });
  const response = NextResponse.json({
    user: { id: user.id, name: user.name, role: user.role },
    mustChangePassword: user.mustChangePassword,
    workspace: workspaceForUser(user),
  });
  response.cookies.set(SESSION_COOKIE, session.id, sessionCookie);
  return response;
}
