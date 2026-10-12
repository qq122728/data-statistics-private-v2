import { describe, expect, it } from "vitest";
import { readResourceAdminSession } from "../../apps/frontline/lib/resource-admin-session";

const respond = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as typeof fetch;
describe("resource admin session navigation", () => {
  it("keeps network, server and malformed response failures retryable instead of logging out", async () => {
    for (const request of [respond({}, 502), respond({}, 403), respond({}), (async () => { throw new TypeError("Network error"); }) as typeof fetch]) {
      expect((await readResourceAdminSession(request)).kind).toBe("error");
    }
  });
  it("redirects only expired sessions to login and non-admin accounts to their workspace", async () => {
    expect((await readResourceAdminSession(respond({}, 401))).kind).toBe("login");
    expect((await readResourceAdminSession(respond({ user: { id: "resource", role: "RESOURCE_MANAGER" } }))).kind).toBe("home");
  });
  it("opens ADMIN and HQ_MANAGER sessions and recovers after a failed request", async () => {
    expect((await readResourceAdminSession(respond({}, 503))).kind).toBe("error");
    for (const user of [{ id: "admin", role: "ADMIN" }, { id: "hq", role: "COMPANY_MANAGER", duty: "HQ_MANAGER" }]) {
      expect(await readResourceAdminSession(respond({ user }))).toEqual({ kind: "ready", user });
    }
  });
});
