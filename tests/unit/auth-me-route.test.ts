import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/auth/me/route";
import * as auth from "../../src/lib/auth";

afterEach(() => vi.restoreAllMocks());

describe("auth me route", () => {
  it("returns only the signed-in identity and organization scope", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue({
      id: "me-1",
      employeeCode: "lead",
      username: "lead",
      name: "本地组长",
      passwordHash: "must-not-leak",
      mustChangePassword: false,
      role: "LEAD",
      duty: null,
      groupId: null,
      departmentId: null,
      companyId: null,
      active: true,
      managementScopeName: null,
      managementCountryCode: null,
      hireDate: null,
      recruitmentSource: null,
      referrerName: null,
      stageOverride: null,
      stageOverrideReason: null,
      stageOverrideAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      roleAssignments: [{ role: "LEAD" }],
      resourceChannelAccess: [],
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.user).toMatchObject({ id: "me-1", username: "lead", name: "本地组长", role: "LEAD", roles: ["LEAD"] });
    expect(JSON.stringify(payload)).not.toContain("must-not-leak");
  });

  it("returns 401 without a session", async () => {
    vi.spyOn(auth, "requireUser").mockRejectedValue(new auth.AuthenticationError());
    const response = await GET();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录" });
  });
});
