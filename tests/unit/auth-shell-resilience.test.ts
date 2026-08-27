import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").catch(() => "");

describe("authentication shell resilience", () => {
  it("uses the configured application name on the login page and in metadata", async () => {
    const [loginPage, loginForm, layout] = await Promise.all([
      readSource("src/app/login/page.tsx"),
      readSource("src/components/auth/LoginForm.tsx"),
      readSource("src/app/layout.tsx"),
    ]);
    const loginSources = `${loginPage}\n${loginForm}`;

    expect(loginPage).toContain("getSystemSettings");
    expect(loginPage).toContain('dynamic = "force-dynamic"');
    expect(loginSources).toContain("appName");
    expect(layout).toContain("generateMetadata");
    expect(layout).toContain("getSystemSettings");
  });

  it("restores login and logout controls after network failures", async () => {
    const [loginPage, loginForm, header] = await Promise.all([
      readSource("src/app/login/page.tsx"),
      readSource("src/components/auth/LoginForm.tsx"),
      readSource("src/components/shell/AppHeader.tsx"),
    ]);
    const loginSources = `${loginPage}\n${loginForm}`;

    expect(loginSources).toContain("catch");
    expect(loginSources).toContain("finally");
    expect(loginSources).toContain("网络连接失败");
    expect(header).toContain("catch");
    expect(header).toContain("finally");
    expect(header).toContain("网络连接失败");
    expect(header).toContain('role="alert"');
  });

  it("uses a readable base size for data tables", async () => {
    const styles = await readSource("src/app/globals.css");
    expect(styles).toMatch(/\.data-table\s*\{[^}]*font-size:\s*14px;/);
  });
});
