import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getVisibleAppNavigation } from "../../src/lib/app-navigation";

describe("shared performance leaderboard access", () => {
  it("is discoverable by every authenticated role", () => {
    for (const role of ["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER", "LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const) {
      expect(getVisibleAppNavigation(role)).toContainEqual({ href: "/performance-leaderboard", label: "精英榜" });
    }
  });

  it("keeps the public leaderboard while scoping company and department managers", () => {
    const source = readFileSync("src/app/(app)/performance-leaderboard/page.tsx", "utf8");
    expect(source).toContain('user.role === "RESOURCE_MANAGER" || user.role === "COMPANY_MANAGER"');
    expect(source).toContain("resolveReadableReportGroups(scopedUser, groups)");
    expect(source).toContain("HeadquartersPerformanceLeaderboard");
    expect(source).toContain("loadPerformanceLeaderboard");
    expect(source).not.toContain("loadManagementOverview");
    expect(source).toContain("LeadDateRangeFilter");
    expect(source).toContain('range: "month"');
    expect(source).toContain("不展示客户或个人资料");
    expect(source).not.toContain("lead.phone");
  });
});
