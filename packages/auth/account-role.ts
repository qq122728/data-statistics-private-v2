import { WORKSPACE_LABELS } from "../workspace/navigation";

/** Display only: read actual login roles, never use this label for authorization. */
export function accountRoleLabel(user: { role: string; roles: readonly string[]; duty?: string | null; resourceChannelTypes?: readonly string[] }) {
  if (user.role === "ADMIN") return WORKSPACE_LABELS.systemAdmin;
  if (user.duty === "HQ_MANAGER") return WORKSPACE_LABELS.hqAdmin;
  if (user.duty === "COMPANY_MANAGER") return "公司管理员";
  if (user.duty === "DEPARTMENT_MANAGER") return "部门管理员";
  if (user.role === "RESOURCE_MANAGER") {
    const types = user.resourceChannelTypes ?? [];
    return types.length === 1 ? types[0] === "ADS" ? "资源部·投流" : types[0] === "SMS" ? "资源部·短信" : "资源部管理员" : "资源部管理员";
  }
  const names: Record<string, string> = { LEAD: "组长", RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家", FINANCE: "财务", HR: "人事" };
  const roles = new Set([user.role, ...user.roles]);
  return Object.entries(names).filter(([role]) => roles.has(role)).map(([, label]) => label).join(" / ") || "组员";
}
