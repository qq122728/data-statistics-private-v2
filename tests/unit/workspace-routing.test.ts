import { describe, expect, it } from "vitest";
import { workspaceForUser } from "../../src/lib/workspace-routing";

describe("login workspace routing", () => {
  it.each(["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const)("routes %s to the frontline workspace", (role) => {
    expect(workspaceForUser({ role, duty: null })).toBe("FRONTLINE");
  });

  it.each(["ADMIN", "COMPANY_MANAGER", "LEAD"] as const)("routes %s to the admin workspace", (role) => {
    expect(workspaceForUser({ role, duty: null })).toBe("ADMIN");
  });

  it.each(["DEPARTMENT_MANAGER", "COMPANY_MANAGER", "HQ_MANAGER"] as const)("routes %s to the new frontline workspace", (duty) => {
    expect(workspaceForUser({ role: "COMPANY_MANAGER", duty })).toBe("FRONTLINE");
  });

  it("routes resource managers to the new resource workspace", () => {
    expect(workspaceForUser({ role: "RESOURCE_MANAGER", duty: null })).toBe("FRONTLINE");
  });

  it.each(["FINANCE", "HR"] as const)("routes %s to the new read-only notification workspace", (role) => {
    expect(workspaceForUser({ role, duty: null })).toBe("FRONTLINE");
  });
});
