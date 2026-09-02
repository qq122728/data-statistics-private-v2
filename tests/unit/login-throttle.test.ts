import { afterEach, describe, expect, it } from "vitest";
import {
  loginRetryAfterMs,
  recordFailedLogin,
  recordSuccessfulLogin,
  resetLoginThrottleForTests,
} from "../../src/lib/login-throttle";

afterEach(async () => resetLoginThrottleForTests());

describe("login throttling", () => {
  it("locks a single account after repeated failed passwords", async () => {
    const identity = { ip: "203.0.113.10", username: "reception-a" };
    const now = 1_000_000;
    for (let count = 0; count < 8; count += 1) await recordFailedLogin(identity, now + count);

    expect(await loginRetryAfterMs(identity, now + 8)).toBeGreaterThan(0);
  });

  it("also locks a source that spreads attempts across many account names", async () => {
    const now = 2_000_000;
    for (let count = 0; count < 20; count += 1) {
      await recordFailedLogin({ ip: "203.0.113.11", username: `user-${count}` }, now + count);
    }

    expect(await loginRetryAfterMs({ ip: "203.0.113.11", username: "another-user" }, now + 20)).toBeGreaterThan(0);
  });

  it("clears an account failure record after a successful login", async () => {
    const identity = { ip: "203.0.113.12", username: "expert-a" };
    const now = 3_000_000;
    for (let count = 0; count < 8; count += 1) await recordFailedLogin(identity, now + count);
    await recordSuccessfulLogin(identity);

    expect(await loginRetryAfterMs(identity, now + 8)).toBe(0);
  });
});
