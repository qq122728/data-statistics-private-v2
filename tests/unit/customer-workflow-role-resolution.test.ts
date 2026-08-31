import { describe, expect, it } from "vitest";
import { authorizeCustomerAction, resolveWorkflowActorRole } from "../../src/lib/customer-workflow/access";

describe("组员按客户当前负责关系选择流程身份", () => {
  const actor = {
    id: "three-role-member",
    role: "RECEPTION" as const,
    groupId: "group-a",
    active: true,
    roleAssignments: [],
  };
  const joinedLead = {
    ownerId: actor.id,
    groupOperatorOwnerId: actor.id,
    expertOwnerId: actor.id,
    groupStatus: "JOINED" as const,
    batch: { groupId: "group-a" },
  };

  it("旧岗位不是专家时，明确分配为专家负责人仍可处理专家动作", () => {
    expect(resolveWorkflowActorRole(actor, joinedLead, "beginExpertReception")).toBe("EXPERT");
    expect(resolveWorkflowActorRole(actor, joinedLead, "register")).toBe("EXPERT");
  });

  it("旧岗位不是炒群时，明确分配为炒群负责人仍可处理炒群动作", () => {
    expect(resolveWorkflowActorRole(actor, { ...joinedLead, expertOwnerId: null }, "introduceExpert")).toBe("GROUP_OPERATOR");
    expect(resolveWorkflowActorRole(actor, { ...joinedLead, groupStatus: "NOT_JOINED", expertOwnerId: null }, "reply")).toBe("RECEPTION");
  });

  it("同组但未被明确分配的组员不能修改炒群或专家状态", async () => {
    const unassignedLead = { ...joinedLead, groupOperatorOwnerId: "other-member", expertOwnerId: "other-member" };
    const transaction = {} as Parameters<typeof authorizeCustomerAction>[0];
    await expect(authorizeCustomerAction(transaction, actor, unassignedLead, "introduceExpert"))
      .resolves.toEqual({ status: 403, error: "当前岗位不能处理该客户或执行此操作" });
    await expect(authorizeCustomerAction(transaction, actor, unassignedLead, "register"))
      .resolves.toEqual({ status: 403, error: "当前岗位不能处理该客户或执行此操作" });
  });

  it("同组未分配成员也能维护共享表的炒群和专家情况", async () => {
    const sharedLead = { ...joinedLead, groupOperatorOwnerId: "other-member", expertOwnerId: "other-member" };
    const transaction = {} as Parameters<typeof authorizeCustomerAction>[0];
    await expect(authorizeCustomerAction(transaction, actor, sharedLead, "updateGroupProgress")).resolves.toBeNull();
    await expect(authorizeCustomerAction(transaction, actor, sharedLead, "updateExpertDetails")).resolves.toBeNull();
    expect(resolveWorkflowActorRole(actor, sharedLead, "updateGroupProgress")).toBe("GROUP_OPERATOR");
    expect(resolveWorkflowActorRole(actor, sharedLead, "updateExpertDetails")).toBe("EXPERT");
  });

  it("客户调到别组后，原小组负责人不能再绕过当前归属直接修改", async () => {
    const movedLead = { ...joinedLead, currentGroupId: "group-b" };
    const transaction = {} as Parameters<typeof authorizeCustomerAction>[0];
    await expect(authorizeCustomerAction(transaction, actor, movedLead, "register"))
      .resolves.toEqual({ status: 403, error: "该客户当前已不属于你所在的小组" });
  });
});
