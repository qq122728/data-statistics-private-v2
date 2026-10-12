import type { BackendUser } from "./backend";

type ResourceAdminSession =
  | { kind: "ready"; user: BackendUser }
  | { kind: "login" }
  | { kind: "home" }
  | { kind: "error"; message: string };

/** A temporary API failure must not be treated as an expired login. */
export async function readResourceAdminSession(request: typeof fetch = fetch): Promise<ResourceAdminSession> {
  try {
    const response = await request("/api/auth/me", { cache: "no-store" });
    if (response.status === 401) return { kind: "login" };
    if (!response.ok) return { kind: "error", message: "暂时无法读取登录身份，请重试。" };
    const payload = await response.json() as { user?: BackendUser };
    if (!payload.user?.id || !payload.user.role) return { kind: "error", message: "登录身份信息未完整返回，请重试。" };
    if (payload.user.role !== "ADMIN" && payload.user.duty !== "HQ_MANAGER") return { kind: "home" };
    return { kind: "ready", user: payload.user };
  } catch {
    return { kind: "error", message: "连接暂时中断，请重试。" };
  }
}
