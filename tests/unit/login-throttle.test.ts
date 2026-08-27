import { afterEach, describe, expect, it } from "vitest";
import {
  loginRetryAfterMs,
  recordFailedLogin,
  recordSuccessfulLogin,
  resetLoginThrottleForTests,
} from "../../src/lib/login-throttle";

afterEach(() => resetLoginThrottleForTests());

describe("login throttling", () => {
  it("locks a single account after repeated failed passwords", () => {
    const identity = { ip: "203.0.113.10", username: "reception-a" };
    const now = 1_000_000;
    for (let count = 0; count < 8; count += 1) recordFailedLogin(identity, now + count);

    expect(loginRetryAfterMs(identity, now + 8)).toBeGreaterThan(0);
  });

  it("also locks a source that spreads attempts across many account names", () => {
    const now = 2_000_000;
    for (let count = 0; count < 20; count += 1) {
      recordFailedLogin({ ip: "203.0.113.11", username: `user-${count}` }, now + count);
    }

    expect(loginRetryAfterMs({ ip: "203.0.113.11", username: "another-user" }, now + 20)).toBeGreaterThan(0);
  });

  it("clears an account failure record after a successful login", () => {
    const identity = { ip: "203.0.113.12", username: "expert-a" };
    const now = 3_000_000;
    for (let count = 0; count < 8; count += 1) recordFailedLogin(identity, now + count);
    recordSuccessfulLogin(identity);

    expect(loginRetryAfterMs(identity, now + 8)).toBe(0);
  });
});
