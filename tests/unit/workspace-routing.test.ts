import { describe, expect, it } from "vitest";
import { workspaceForUser } from "../../src/lib/workspace-routing";

describe("login workspace routing", () => {
  it.each(["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const)("routes %s to the frontline workspace", (role) => {
    expect(workspaceForUser({ role, duty: null })).toBe("FRONTLINE");
  });

  it.each(["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER", "FINANCE", "HR", "LEAD"] as const)("routes %s to the admin workspace", (role) => {
    expect(workspaceForUser({ role, duty: null })).toBe("ADMIN");
  });

  it("routes every management duty to the admin workspace even if the legacy primary role is frontline", () => {
    expect(workspaceForUser({ role: "EXPERT", duty: "HQ_MANAGER" })).toBe("ADMIN");
  });
});
