import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import * as adminAuth from "../../src/app/api/admin/_auth";
import { POST } from "../../src/app/api/admin/groups/route";
import { PATCH as patchCustomerFollowUp } from "../../src/app/api/admin/customer-follow-up/route";

describe("admin route authorization failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rethrows an unexpected authorization dependency error for Next to report as a server error", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new Error("session database unavailable"));

    try {
      await POST(new Request("http://localhost/api/admin/groups", {
        method: "POST",
        body: JSON.stringify({ name: "不应创建" }),
      }));
      expect.unreachable("unexpected failures must not become authorization responses");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("session database unavailable");
    }
  });

  it("旧管理员客户跟进写入口明确停用", async () => {
    vi.spyOn(adminAuth, "requireAdminRequest").mockResolvedValue({
      actor: { id: "admin-read-only" },
    } as never);
    const response = await patchCustomerFollowUp(
      new Request("http://localhost/api/admin/customer-follow-up", {
        method: "PATCH",
        body: JSON.stringify({ leadId: "any", followUpPlan: "不应保存" }),
      }),
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("已停用"),
    });
  });
});
