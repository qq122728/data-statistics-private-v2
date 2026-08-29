import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("application header identity", () => {
  it("receives and renders the current user name, role and organization scope", async () => {
    const [layout, header, styles] = await Promise.all([
      readSource("src/app/(app)/layout.tsx"),
      readSource("src/components/shell/AppHeader.tsx"),
      readSource("src/app/globals.css"),
    ]);

    expect(layout).toContain("userName={user.name}");
    expect(layout).toContain("const organizationName = user.managementScopeName ?? group?.name ?? department?.name ?? managedCompany?.name");
    expect(layout).toContain("groupName={organizationName}");
    expect(header).toContain("userName");
    expect(header).toContain("groupName");
    expect(header).toContain("app-header-identity");
    expect(header).toContain("WorkflowConfirmationDialog");
    expect(header).toContain("确认退出登录？");
    expect(header).toContain('aria-haspopup="dialog"');
    expect(styles).toContain(".app-header-identity");
    expect(styles).toContain(".app-logout-icon");
    expect(styles).toContain(".app-logout:focus-visible");
    expect(styles).not.toContain(".app-topbar-actions > span { display: none; }");
  });
});
