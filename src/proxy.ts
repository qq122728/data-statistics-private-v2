import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "data-statistics-session";

/**
 * 登录跳转必须使用配置好的正式站点地址，不能相信客户端请求带来的
 * Host / X-Forwarded-Host。否则攻击者可把未登录用户带到仿冒登录页。
 * 本地开发未配置时才回退到当前请求地址，便于 localhost 正常使用。
 */
function publicAppOrigin(request: NextRequest): string {
  const configured = process.env.APP_PUBLIC_ORIGIN?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      ) {
        return url.origin;
      }
    } catch {
      // 配置写错时保持本地开发可用；生产环境由部署检查确保已配置。
    }
  }
  return request.nextUrl.origin;
}

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", publicAppOrigin(request));
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
