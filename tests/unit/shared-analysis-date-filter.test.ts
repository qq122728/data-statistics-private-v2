import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = [
  "dashboard",
  "team-performance",
  "channel-analysis",
  "batch-tracking",
  "role-rankings",
  "group-daily-detail",
  "resource-conversion",
];

describe("shared analysis date filter", () => {
  it.each(pages)("uses the shared preset filter on %s", (page) => {
    const source = readFileSync(`src/app/(app)/${page}/page.tsx`, "utf8");
    expect(source).toContain("LeadDateRangeFilter");
  });

  it("keeps resource filters and pagination inside the selected date range", () => {
    const source = readFileSync("src/app/(app)/resource-conversion/page.tsx", "utf8");
    expect(source).toContain('preserved.set("range", dateRange.preset)');
    expect(source).toContain('name="sourceDateFrom" value={dateRange.from}');
    expect(source).not.toContain("<span>来源开始</span>");
    expect(source).not.toContain("<span>来源结束</span>");
  });

  it("does not expose duplicate raw date fields in the management dashboard", () => {
    const source = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
    expect(source).not.toContain("dates: !isLead");
    expect(source).toContain("resolveDateRangeWithDefault");
  });
});
