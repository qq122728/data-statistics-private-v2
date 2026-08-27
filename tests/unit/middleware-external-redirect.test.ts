import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "../../src/proxy";

describe("external login redirect", () => {
  const originalPublicOrigin = process.env.APP_PUBLIC_ORIGIN;

  afterEach(() => {
    if (originalPublicOrigin === undefined) delete process.env.APP_PUBLIC_ORIGIN;
    else process.env.APP_PUBLIC_ORIGIN = originalPublicOrigin;
  });

  it("only uses the configured public origin, never a client-controlled forwarded host", () => {
    process.env.APP_PUBLIC_ORIGIN = "https://hgykny55888.it.com";
    const response = proxy(new NextRequest("http://localhost:3000/", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "phishing-example.invalid",
        "x-forwarded-proto": "https",
      },
    }));
    expect(response.headers.get("location")).toBe("https://hgykny55888.it.com/login?next=%2F");
  });

  it("uses the request origin for local development when no public origin is configured", () => {
    delete process.env.APP_PUBLIC_ORIGIN;
    const response = proxy(new NextRequest("http://localhost:3100/dashboard", {
      headers: { "x-forwarded-host": "phishing-example.invalid" },
    }));
    expect(response.headers.get("location")).toBe("http://localhost:3100/login?next=%2Fdashboard");
  });
});
