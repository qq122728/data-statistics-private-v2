import type { LeadGroupStatus, Prisma, Role } from "@prisma/client";
import type { CustomerWorkflowAction } from "./actions";
import { roleAllowsCustomerAction } from "./actions";
import { customerDeleteRoles, getAssignedRoles, hasAssignedRole, isFrontlineGroupMember, roleIsOneOf } from "../role-access";
import { leadCurrentGroupId } from "../customer-current-group";

type WorkflowActor = {
  id: string;
  role: Role;
  groupId: string | null;
  active: boolean;
  roleAssignments?: Array<{ role: Role }>;
};

type WorkflowLead = {
  ownerId: string;
  expertOwnerId: string | null;
  groupOperatorOwnerId?: string | null;
  groupStatus: LeadGroupStatus;
  currentGroupId?: string | null;
  batch: { groupId: string };
};

export type CustomerAccessFailure = { status: 403; error: string };

const expertOnlyActions = new Set<CustomerWorkflowAction>([
  "beginExpertReception", "beginExpertTracking", "markPendingRegistration", "markExpertStalled",
  "clearExpertStalled", "markNoInitialDeposit", "clearNoInitialDeposit", "register", "undoRegister",
  "voidOrder", "updateExpertDetails",
]);

/**
 * 已进群后同时按客户当前负责人和账号当前岗位选择职责。
 * 明确分配决定“负责哪位客户”，岗位授权决定“能不能做这一阶段”。
 */
export function resolveWorkflowActorRole(
  actor: WorkflowActor,
  lead: WorkflowLead,
  action: CustomerWorkflowAction,
): Role | null {
  if (!actor.active) return null;
  if (hasAssignedRole(actor, "LEAD")) return "LEAD";
  if (expertOnlyActions.has(action) && !hasAssignedRole(actor, "EXPERT")) return null;
  // 情况列也必须按当前明确负责人锁定，不能因为“同组可见”就变成“同组可改”。
  if (
    action === "updateGroupProgress" &&
    lead.groupOperatorOwnerId === actor.id &&
    hasAssignedRole(actor, "GROUP_OPERATOR")
  )
    return "GROUP_OPERATOR";
  if (
    action === "updateExpertDetails" &&
    lead.expertOwnerId === actor.id &&
    hasAssignedRole(actor, "EXPERT")
  )
    return "EXPERT";
  if (lead.expertOwnerId === actor.id && roleAllowsCustomerAction("EXPERT", action))
    return "EXPERT";
  if (lead.groupOperatorOwnerId === actor.id && hasAssignedRole(actor, "GROUP_OPERATOR") && roleAllowsCustomerAction("GROUP_OPERATOR", action))
    return "GROUP_OPERATOR";
  if (lead.groupStatus === "NOT_JOINED" && lead.ownerId === actor.id && roleAllowsCustomerAction("RECEPTION", action))
    return "RECEPTION";
  // 以下回退只用于返回更具体的越权说明，不会放行不属于该阶段的动作。
  if (lead.expertOwnerId === actor.id)
    return "EXPERT";
  if (lead.groupOperatorOwnerId === actor.id)
    return "GROUP_OPERATOR";
  if (lead.groupStatus === "NOT_JOINED" && lead.ownerId === actor.id)
    return "RECEPTION";
  return null;
}

export async function authorizeCustomerAction(
  _transaction: Prisma.TransactionClient,
  actor: WorkflowActor,
  lead: WorkflowLead,
  action: CustomerWorkflowAction,
): Promise<CustomerAccessFailure | null> {
  if (!isFrontlineGroupMember(actor))
    return { status: 403, error: "当前岗位不能在此修改客户" };

  if (leadCurrentGroupId(lead) !== actor.groupId)
    return { status: 403, error: "该客户当前已不属于你所在的小组" };

  // 只有具备炒群岗位且是当前负责人时才能写；组长仍可管理本组全部阶段。
  if (action === "updateGroupProgress")
    return hasAssignedRole(actor, "LEAD") ||
      (lead.groupOperatorOwnerId === actor.id && hasAssignedRole(actor, "GROUP_OPERATOR"))
      ? null
      : { status: 403, error: "只有该客户当前炒群负责人或组长可以填写炒群情况" };
  if (expertOnlyActions.has(action) && !hasAssignedRole(actor, "EXPERT"))
    return { status: 403, error: "需要专家权限才能处理专家阶段" };
  if (action === "updateExpertDetails")
    return hasAssignedRole(actor, "LEAD") ||
      (lead.expertOwnerId === actor.id && hasAssignedRole(actor, "EXPERT"))
      ? null
      : { status: 403, error: "只有该客户当前专家负责人或组长可以填写专家进度" };

  const effectiveRole = resolveWorkflowActorRole(actor, lead, action);
  if (!effectiveRole) return { status: 403, error: "当前岗位不能处理该客户或执行此操作" };

  if (effectiveRole === "RECEPTION" && lead.ownerId !== actor.id)
    return { status: 403, error: "只能修改自己的客户" };
  if (effectiveRole === "RECEPTION" && leadCurrentGroupId(lead) !== actor.groupId)
    return { status: 403, error: "该客户当前已不属于你所在的小组" };
  if (effectiveRole === "RECEPTION" && lead.groupStatus !== "NOT_JOINED")
    return { status: 403, error: "客户已确认入群并交棒，接粉只能查看后续进度" };
  if (effectiveRole === "RECEPTION" && !roleAllowsCustomerAction(effectiveRole, action))
    return { status: 403, error: "前台接粉只能录入号码、回复回访、确认入群和补充自己的备注" };

  if (effectiveRole === "LEAD" && leadCurrentGroupId(lead) !== actor.groupId)
    return { status: 403, error: "只能修改本组客户" };

  if (effectiveRole === "GROUP_OPERATOR") {
    if (!hasAssignedRole(actor, "GROUP_OPERATOR"))
      return { status: 403, error: "当前账号没有炒群岗位权限" };
    const ownsFrozenCustomer = lead.groupOperatorOwnerId === actor.id;
    if (!ownsFrozenCustomer)
      return { status: 403, error: "只能跟进明确分配给你的炒群客户" };
    if (!roleAllowsCustomerAction(effectiveRole, action))
      return { status: 403, error: "前台炒群只能更新退群、推专家、客户资料和备注" };
  }

  if (effectiveRole === "EXPERT" && lead.expertOwnerId !== actor.id)
    return { status: 403, error: "只能跟进分配给自己的专家客户" };
  if (effectiveRole === "EXPERT" && leadCurrentGroupId(lead) !== actor.groupId)
    return { status: 403, error: "该客户当前已不属于你所在的小组" };
  if (effectiveRole === "EXPERT" && !roleAllowsCustomerAction(effectiveRole, action))
    return { status: 403, error: "前台专家只能推进专家阶段、更新客户资料、备注和开单纠错" };

  if (action === "updateGroupDetails" && effectiveRole !== "LEAD" && effectiveRole !== "GROUP_OPERATOR")
    return { status: 403, error: "只有组长和前台炒群可以编辑群客户资料" };

  return null;
}

export function authorizeCustomerDelete(actor: WorkflowActor, lead: WorkflowLead): CustomerAccessFailure | null {
  if (!actor.active) return { status: 403, error: "当前岗位不能删除客户" };
  if (!getAssignedRoles(actor).some((role) => roleIsOneOf(role, customerDeleteRoles)))
    return { status: 403, error: "当前岗位不能删除客户" };
  if (hasAssignedRole(actor, "LEAD") && leadCurrentGroupId(lead) !== actor.groupId)
    return { status: 403, error: "只能删除本组客户" };
  if (!hasAssignedRole(actor, "LEAD") && lead.ownerId !== actor.id)
    return { status: 403, error: "只能删除自己的客户" };
  return null;
}
