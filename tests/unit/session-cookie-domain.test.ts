import { describe, expect, it } from "vitest";
import { configuredSessionCookieDomain } from "../../src/lib/auth";

describe("shared session cookie domain", () => {
  it("keeps the setting optional for same-origin deployments", () => {
    expect(configuredSessionCookieDomain(undefined)).toBeUndefined();
    expect(configuredSessionCookieDomain("  ")).toBeUndefined();
  });

  it("accepts an exact parent domain for trusted sibling workspaces", () => {
    expect(configuredSessionCookieDomain(" .localtest.me ")).toBe(".localtest.me");
    expect(configuredSessionCookieDomain("Example.COM")).toBe("example.com");
  });

  it.each(["http://example.com", "example.com:3000", "/example.com", "localhost", "127.0.0.1", ".bad_domain.test"])("rejects unsafe value %s", (value) => {
    expect(() => configuredSessionCookieDomain(value)).toThrow(/纯域名/);
  });
});
