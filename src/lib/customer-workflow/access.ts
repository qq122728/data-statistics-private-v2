import type { Prisma, Role } from "@prisma/client";
import type { CustomerWorkflowAction } from "./actions";
import { canUseCustomerWorkflow, roleAllowsCustomerAction } from "./actions";
import { customerDeleteRoles, getAssignedRoles, hasAssignedRole, roleIsOneOf } from "../role-access";

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
  batch: { groupId: string };
};

export type CustomerAccessFailure = { status: 403; error: string };

function canActAsGroupOperator(actor: WorkflowActor, lead: WorkflowLead) {
  return hasAssignedRole(actor, "GROUP_OPERATOR")
    && Boolean(actor.groupId && actor.groupId === lead.batch.groupId);
}

/**
 * 同一账号兼任时，按本次动作选择职责，而不是机械地读取主岗位。
 * 接粉动作只会走接粉职责；炒群动作只会走炒群职责。
 */
export function resolveWorkflowActorRole(
  actor: WorkflowActor,
  lead: WorkflowLead,
  action: CustomerWorkflowAction,
): Role | null {
  if (!actor.active) return null;
  if (hasAssignedRole(actor, "LEAD")) return "LEAD";
  const roles = getAssignedRoles(actor);
  if (roles.includes("GROUP_OPERATOR") && canActAsGroupOperator(actor, lead) && roleAllowsCustomerAction("GROUP_OPERATOR", action))
    return "GROUP_OPERATOR";
  if (roles.includes("RECEPTION") && lead.ownerId === actor.id)
    return "RECEPTION";
  if (roles.includes("GROUP_OPERATOR") && canActAsGroupOperator(actor, lead))
    return "GROUP_OPERATOR";
  if (roles.includes("EXPERT") && lead.expertOwnerId === actor.id)
    return "EXPERT";
  return null;
}

export async function authorizeCustomerAction(
  transaction: Prisma.TransactionClient,
  actor: WorkflowActor,
  lead: WorkflowLead,
  action: CustomerWorkflowAction,
): Promise<CustomerAccessFailure | null> {
  if (!actor.active || !getAssignedRoles(actor).some((role) => canUseCustomerWorkflow(role)))
    return { status: 403, error: "当前岗位不能在此修改客户" };

  const effectiveRole = resolveWorkflowActorRole(actor, lead, action);
  if (!effectiveRole) return { status: 403, error: "当前岗位不能处理该客户或执行此操作" };

  if (effectiveRole === "RECEPTION" && lead.ownerId !== actor.id)
    return { status: 403, error: "只能修改自己的客户" };
  if (effectiveRole === "RECEPTION" && !roleAllowsCustomerAction(effectiveRole, action))
    return { status: 403, error: "前台接粉只能录入号码、回复回访、确认入群和补充自己的备注" };

  if (effectiveRole === "LEAD" && lead.batch.groupId !== actor.groupId)
    return { status: 403, error: "只能修改本组客户" };

  if (effectiveRole === "GROUP_OPERATOR") {
    const ownsFrozenCustomer = lead.groupOperatorOwnerId === actor.id;
    const ownsOwnReceptionCustomer = hasAssignedRole(actor, "RECEPTION") && lead.ownerId === actor.id;
    const collaboration = lead.groupOperatorOwnerId || ownsOwnReceptionCustomer
      ? null
      : await transaction.groupOperatorReception.findUnique({
          where: {
            groupOperatorId_receptionistId: {
              groupOperatorId: actor.id,
              receptionistId: lead.ownerId,
            },
          },
          select: { groupOperatorId: true },
        });
    if ((!ownsFrozenCustomer && !ownsOwnReceptionCustomer && !collaboration) || lead.batch.groupId !== actor.groupId)
      return { status: 403, error: "只能跟进组长分配给你的前台客户" };
    if (!roleAllowsCustomerAction(effectiveRole, action))
      return { status: 403, error: "前台炒群只能更新退群、推专家、客户资料和备注" };
  }

  if (effectiveRole === "EXPERT" && lead.expertOwnerId !== actor.id)
    return { status: 403, error: "只能跟进分配给自己的专家客户" };
  if (effectiveRole === "EXPERT" && !roleAllowsCustomerAction(effectiveRole, action))
    return { status: 403, error: "前台专家只能推进专家阶段、更新客户资料、备注和开单纠错" };

  if (action === "updateExpertDetails" && effectiveRole !== "LEAD" && effectiveRole !== "EXPERT")
    return { status: 403, error: "只有组长和负责该客户的专家可以编辑专家跟进资料" };

  if (action === "updateGroupDetails" && effectiveRole !== "LEAD" && effectiveRole !== "GROUP_OPERATOR")
    return { status: 403, error: "只有组长和前台炒群可以编辑群客户资料" };

  return null;
}

export function authorizeCustomerDelete(actor: WorkflowActor, lead: WorkflowLead): CustomerAccessFailure | null {
  if (!actor.active) return { status: 403, error: "当前岗位不能删除客户" };
  if (!getAssignedRoles(actor).some((role) => roleIsOneOf(role, customerDeleteRoles)))
    return { status: 403, error: "当前岗位不能删除客户" };
  if (hasAssignedRole(actor, "LEAD") && lead.batch.groupId !== actor.groupId)
    return { status: 403, error: "只能删除本组客户" };
  if (!hasAssignedRole(actor, "LEAD") && lead.ownerId !== actor.id)
    return { status: 403, error: "只能删除自己的客户" };
  return null;
}
