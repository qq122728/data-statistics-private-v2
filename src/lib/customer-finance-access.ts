import { canWriteCustomerRevenue } from "./permissions";
import { customerOrderWriteRoles } from "./role-access";

// 兼容已有资金路由；实际规则与开单统一维护在 permissions.ts。
export const financeWriteRoles = customerOrderWriteRoles;
export const canWriteCustomerFinance = canWriteCustomerRevenue;

export function financeScopeError(role: string) {
  if (role === "EXPERT") return "只能处理分配给自己的专家客户资金";
  if (role === "LEAD") return "只能处理本组客户资金";
  return "当前岗位不能登记或修改资金流水";
}
