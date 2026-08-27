import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../../src/app/api/auth/login/route";
import { resetLoginThrottleForTests } from "../../src/lib/login-throttle";

const request = () => new Request("http://localhost/api/auth/login", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-real-ip": "203.0.113.99",
  },
  body: JSON.stringify({ username: "admin", password: "wrong-password" }),
});

describe("login route throttling", () => {
  beforeEach(() => resetLoginThrottleForTests());
  afterEach(() => resetLoginThrottleForTests());

  it("returns 429 and retry information after repeated failed passwords", async () => {
    for (let count = 0; count < 8; count += 1) {
      expect((await POST(request())).status).toBe(401);
    }

    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
