import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { GET as getSettings } from "../../src/app/api/admin/settings/route";
import { GET as getAuditLogs } from "../../src/app/api/admin/audit-logs/route";

describe("admin settings and audit authorization", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns 403 for a signed-in non-administrator", async () => {
    const actor = { id: "member-1", role: "RECEPTION", groupId: "group-a", active: true } as never;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(auth, "requireRole").mockImplementation(async () => {
      throw new auth.AuthorizationError(undefined, actor);
    });
    const response = await getSettings();
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Security-Audit")).toBe("app");
    expect(info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      event: "AUTHORIZATION_DENIED",
      userId: "member-1",
      teamId: "group-a",
      result: "denied",
    });

    info.mockClear();
    const auditResponse = await getAuditLogs(new Request("http://localhost/api/admin/audit-logs"));
    expect(auditResponse.status).toBe(403);
    expect(auditResponse.headers.get("X-Security-Audit")).toBe("app");
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when there is no authenticated session", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new auth.AuthenticationError());
    expect((await getSettings()).status).toBe(401);
  });
});
