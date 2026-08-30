import { describe, expect, it } from "vitest";
import { hasAssignedRole, getAssignedRoles } from "../../src/lib/role-access";

describe("兼任岗位访问", () => {
  it("接粉主岗兼任炒群后同时拥有两个一线岗位", () => {
    const user = {
      role: "RECEPTION" as const,
      active: true,
      roleAssignments: [{ role: "GROUP_OPERATOR" as const }],
    };

    expect(hasAssignedRole(user, "RECEPTION")).toBe(true);
    expect(hasAssignedRole(user, "GROUP_OPERATOR")).toBe(true);
    expect(getAssignedRoles(user)).toEqual(["RECEPTION", "GROUP_OPERATOR"]);
  });

  it("停用账号即使保留兼任岗位也不能取得访问权限", () => {
    expect(hasAssignedRole({
      role: "RECEPTION" as const,
      active: false,
      roleAssignments: [{ role: "GROUP_OPERATOR" as const }],
    }, "GROUP_OPERATOR")).toBe(false);
  });

  it("组长默认同时拥有专家岗位权限", () => {
    const lead = { role: "LEAD" as const, active: true, roleAssignments: [] };

    expect(getAssignedRoles(lead)).toEqual(["LEAD", "EXPERT"]);
    expect(hasAssignedRole(lead, "EXPERT")).toBe(true);
  });
});
