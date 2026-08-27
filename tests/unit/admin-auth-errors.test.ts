import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { POST } from "../../src/app/api/admin/groups/route";

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
});
