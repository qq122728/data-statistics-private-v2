import type { Role } from "@prisma/client";

export const customerWorkflowActions = [
  "voidErroneousEntry",
  "restoreValid",
  "classifyReception",
  "assignDevice",
  "followUp",
  "reply",
  "undoReply",
  "updateReceptionChatStatus",
  "archiveRepliedCustomer",
  "joinGroup",
  "leaveGroup",
  "introduceExpert",
  "register",
  "note",
  "updateProfile",
  "updatePhone",
  "markExpertContacted",
  "beginExpertReception",
  "beginExpertTracking",
  "markPendingRegistration",
  "undoExpertContacted",
  "markExpertStalled",
  "clearExpertStalled",
  "markNoInitialDeposit",
  "clearNoInitialDeposit",
  "updateGroupProgress",
  "updateGroupDetails",
  "undoJoinGroup",
  "undoLeaveGroup",
  "undoIntroduceExpert",
  "undoRegister",
  "voidOrder",
  "updateExpertDetails",
] as const;

export type CustomerWorkflowAction = (typeof customerWorkflowActions)[number];

export const correctionActions = [
  "undoReply",
  "undoJoinGroup",
  "undoLeaveGroup",
  "undoIntroduceExpert",
  "undoExpertContacted",
  "undoRegister",
  "voidOrder",
] as const satisfies readonly CustomerWorkflowAction[];

export function isCorrectionAction(action: CustomerWorkflowAction): boolean {
  return correctionActions.some((candidate) => candidate === action);
}

const roleActions: Partial<Record<Role, readonly CustomerWorkflowAction[]>> = {
  RECEPTION: [
    "voidErroneousEntry",
    "restoreValid",
    "classifyReception",
    "assignDevice",
    "followUp",
    "reply",
    "undoReply",
    "updateReceptionChatStatus",
    "archiveRepliedCustomer",
    "joinGroup",
    "note",
    "updateProfile",
    "updatePhone",
  ],
  GROUP_OPERATOR: [
    "leaveGroup",
    "undoLeaveGroup",
    "introduceExpert",
    "undoIntroduceExpert",
    "updateGroupProgress",
    "updateGroupDetails",
    "note",
    "updateProfile",
  ],
  EXPERT: [
    "beginExpertReception",
    "beginExpertTracking",
    "markPendingRegistration",
    "markExpertStalled",
    "clearExpertStalled",
    "markNoInitialDeposit",
    "clearNoInitialDeposit",
    "register",
    "undoRegister",
    "note",
    "updateProfile",
    "voidOrder",
    "updateExpertDetails",
  ],
};

export function roleAllowsCustomerAction(role: Role, action: CustomerWorkflowAction): boolean {
  if (role === "LEAD") return true;
  return roleActions[role]?.includes(action) ?? false;
}

/** A coarse gate for API entry; the exact action is checked before mutation. */
export function canUseCustomerWorkflow(role: Role): boolean {
  return role === "LEAD" || Boolean(roleActions[role]?.length);
}
