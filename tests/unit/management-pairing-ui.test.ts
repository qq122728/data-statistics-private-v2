import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("阶段5b管理页面配对与交接护栏", () => {
  it("shows pending pairing and dual-role self-service as explicit states", () => {
    const source = read("src/components/lead-members/CollaborationSettings.tsx");
    expect(source).toContain("待配对（不自动分配）");
    expect(source).toContain("兼任·本人承接");
    expect(source).toContain("新入群客户不会自动分给任何炒群员");
  });

  it("previews the active-customer count before sending a confirm request", () => {
    const source = read("src/components/lead-members/CollaborationSettings.tsx");
    expect(source.indexOf('mode: "preview"')).toBeGreaterThan(-1);
    expect(source.indexOf('mode: "confirm"')).toBeGreaterThan(source.indexOf('mode: "preview"'));
    expect(source).toContain("expectedCount: preview.count");
    expect(source).toContain("若数量在确认前变化，系统会拒绝并要求重新预览");
  });

  it("uses a real scoped candidate selector instead of a free-text user id", () => {
    const source = read("src/components/company/CompanyOrganizationManager.tsx");
    expect(source).toContain("/api/org/lead-candidates?groupId=");
    expect(source).toContain('<select name="userId"');
    expect(source).not.toContain('<input name="userId"');
  });
});
