import { describe, expect, it } from "vitest";
import { resolveWorkflowActorRole } from "../../src/lib/customer-workflow/access";

describe("多岗位账号按当前动作选择客户流程身份", () => {
  const actor = {
    id: "three-role-member",
    role: "RECEPTION" as const,
    groupId: "group-a",
    active: true,
    roleAssignments: [{ role: "GROUP_OPERATOR" as const }, { role: "EXPERT" as const }],
  };
  const joinedLead = {
    ownerId: actor.id,
    groupOperatorOwnerId: actor.id,
    expertOwnerId: actor.id,
    groupStatus: "JOINED" as const,
    batch: { groupId: "group-a" },
  };

  it("专家动作不会因为本人也是原接粉而被错认成接粉", () => {
    expect(resolveWorkflowActorRole(actor, joinedLead, "beginExpertReception")).toBe("EXPERT");
    expect(resolveWorkflowActorRole(actor, joinedLead, "register")).toBe("EXPERT");
  });

  it("炒群和接粉动作仍分别使用对应岗位", () => {
    expect(resolveWorkflowActorRole(actor, { ...joinedLead, expertOwnerId: null }, "introduceExpert")).toBe("GROUP_OPERATOR");
    expect(resolveWorkflowActorRole(actor, { ...joinedLead, groupStatus: "NOT_JOINED", expertOwnerId: null }, "reply")).toBe("RECEPTION");
  });
});
