export type BackendUser = {
  id: string;
  username: string;
  name: string;
  role: "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "HR" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  roles: BackendUser["role"][];
  duty: "DEPARTMENT_MANAGER" | "COMPANY_MANAGER" | "HQ_MANAGER" | null;
  groupId: string | null;
  groupName: string | null;
  departmentName: string | null;
  companyName: string | null;
  mustChangePassword: boolean;
};

export type LoginResponse = {
  mustChangePassword: boolean;
  workspace: "FRONTLINE" | "ADMIN";
  user: { id: string; name: string; role: BackendUser["role"] };
};

export function workspaceOrigin(workspace: LoginResponse["workspace"]): string {
  const configured = workspace === "ADMIN"
    ? process.env.NEXT_PUBLIC_ADMIN_ORIGIN?.trim()
    : process.env.NEXT_PUBLIC_FRONTLINE_ORIGIN?.trim();
  if (configured) return configured;
  if (typeof window !== "undefined" && window.location.hostname.endsWith(".localtest.me")) {
    return workspace === "ADMIN" ? "http://frontline.localtest.me:3000/admin/" : "http://frontline.localtest.me:3000/";
  }
  if (typeof window !== "undefined") {
    return workspace === "ADMIN" ? `${window.location.origin}/admin/` : `${window.location.origin}/`;
  }
  return workspace === "ADMIN" ? "http://127.0.0.1:3002/" : "http://127.0.0.1:3000/";
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: string; fields?: Record<string, string[]> };
  if (!response.ok) {
    const fieldMessage = payload.fields ? Object.values(payload.fields).flat().find(Boolean) : undefined;
    throw new Error(fieldMessage ? `${payload.error ?? "请检查填写内容"}：${fieldMessage}` : payload.error ?? "操作失败，请稍后重试");
  }
  return payload;
}
