import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("lead dashboard filter wording", () => {
  it("identifies the member filter as reception ownership", async () => {
    const source = await readFile(new URL("../../src/components/lead/LeadDashboardToolbar.tsx", import.meta.url), "utf8");
    expect(source).toContain('aria-label="接粉归属"');
    expect(source).toContain("全部接粉员");
    expect(source).not.toContain('aria-label="人员"');
  });
});
