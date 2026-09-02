export type Position = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";

export type Member = {
  id: string;
  name: string;
  username: string;
  /** 后端主岗位；新增兼任权限时必须保留，不能被前端重新排序后误改。 */
  primaryPosition?: Position;
  mustChangePassword: boolean;
  positions: Position[];
  pairedGroupOperatorId?: string;
  active: boolean;
  joinedGroupDate: string;
};

export type BackendUser = {
  id: string;
  username: string;
  name: string;
  role: "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER" | "FINANCE" | "HR" | "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  roles: BackendUser["role"][];
  duty: "DEPARTMENT_MANAGER" | "COMPANY_MANAGER" | "HQ_MANAGER" | null;
  groupId: string | null;
  groupName: string | null;
  groupType: "HACKER" | "LAWYER" | null;
  departmentId: string | null;
  departmentName: string | null;
  companyId: string | null;
  companyName: string | null;
  mustChangePassword: boolean;
  resourceChannelTypes?: string[];
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
    return workspace === "ADMIN" ? "http://admin.localtest.me:3002/" : "http://frontline.localtest.me:3000/";
  }
  if (typeof window !== "undefined") {
    // 独立管理端开发服务直接挂在 3002 根路径；只有旧的单体服务才使用 /admin/。
    return workspace === "ADMIN"
      ? (window.location.port === "3002" ? `${window.location.origin}/` : `${window.location.origin}/admin/`)
      : `${window.location.origin}/`;
  }
  return workspace === "ADMIN" ? "http://127.0.0.1:3002/" : "http://127.0.0.1:3000/";
}

export type LeadMemberResponse = {
  id: string;
  username: string;
  name: string;
  role: Position;
  roleAssignments: Array<{ role: Position }>;
  groupId: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new Error("无法连接真实后端，请确认服务已运行后重试");
  }
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "操作失败，请稍后重试");
  return payload;
}

export function toMember(
  member: LeadMemberResponse,
  pairingByReceptionist: Map<string, string>,
): Member {
  const positions = [...new Set([member.role, ...member.roleAssignments.map((item) => item.role)])];
  return {
    id: member.id,
    name: member.name,
    username: member.username,
    primaryPosition: member.role,
    mustChangePassword: false,
    positions,
    pairedGroupOperatorId: pairingByReceptionist.get(member.id),
    active: member.active,
    joinedGroupDate: member.createdAt.slice(0, 10),
  };
}

export function generateSecureTemporaryPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}
