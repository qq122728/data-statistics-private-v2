import { describe, expect, it } from "vitest";
import { buildAnalysisHref, parseAnalysisFilters, resolveAnalysisScope } from "../../src/lib/analytics/scope";

describe("management analysis scope", () => {
  it("keeps a lead within its own group and records a forbidden requested group", () => {
    expect(resolveAnalysisScope(
      { id: "lead-a", role: "LEAD", groupId: "group-a", active: true },
      { groupId: "group-b", sourceDateFrom: "2026-07-01", sourceDateTo: "2026-08-12" },
      "2026-08-12",
      ["group-a", "group-b"],
    )).toMatchObject({ groupIds: ["group-a"], requestedForbiddenGroup: true });
  });

  it("denies members access to management analysis", () => {
    expect(() => resolveAnalysisScope(
      { id: "member-a", role: "RECEPTION", groupId: "group-a", active: true },
      {},
      "2026-08-12",
      ["group-a"],
    )).toThrow("管理分析仅限管理员、资源部管理员和组长");
  });

  it("carries only the resource manager's assigned channels into every analysis query", () => {
    const scope = resolveAnalysisScope(
      {
        id: "resource-sms",
        role: "RESOURCE_MANAGER",
        groupId: null,
        active: true,
        resourceChannelAccess: [{ channelId: "sms-channel" }],
      },
      {},
      "2026-08-12",
      ["group-a", "group-b"],
    );

    expect(scope.channelIds).toEqual(["sms-channel"]);
    expect(scope.groupIds).toEqual(["group-a", "group-b"]);
  });

  it("applies defaults, normalizes the channel filter, and encodes share links", () => {
    const scope = resolveAnalysisScope(
      { id: "admin-a", role: "ADMIN", groupId: null, active: true },
      { normalizedName: " 抖音 直播 ", includeInactive: true },
      "2026-08-12",
      ["group-a", "group-b"],
    );

    expect(scope).toMatchObject({
      groupIds: ["group-a", "group-b"], normalizedName: "抖音 直播",
      sourceDateFrom: "2026-07-14", sourceDateTo: "2026-08-12", includeInactive: true,
    });
    expect(buildAnalysisHref("/team-performance", scope)).toBe(
      "/team-performance?normalizedName=%E6%8A%96%E9%9F%B3+%E7%9B%B4%E6%92%AD&sourceDateFrom=2026-07-14&sourceDateTo=2026-08-12&includeInactive=1",
    );
  });

  it("overrides only the requested drill-down filters while keeping the current range", () => {
    const scope = {
      sourceDateFrom: "2026-07-14",
      sourceDateTo: "2026-08-12",
      includeInactive: false,
      groupId: "group-a",
    };

    expect(buildAnalysisHref("/team-performance", scope, { memberId: "member-a" })).toBe(
      "/team-performance?groupId=group-a&memberId=member-a&sourceDateFrom=2026-07-14&sourceDateTo=2026-08-12",
    );
  });

  it("keeps the exact batch identity in a batch drill-down link", () => {
    expect(buildAnalysisHref("/batch-tracking", {
      sourceDateFrom: "2026-07-14",
      sourceDateTo: "2026-08-12",
    }, { batchId: "batch-a", memberId: "member-a" })).toBe(
      "/batch-tracking?batchId=batch-a&memberId=member-a&sourceDateFrom=2026-07-14&sourceDateTo=2026-08-12",
    );
  });

  it("rejects malformed or reversed date ranges and falls back with a readable warning", () => {
    for (const query of [
      "sourceDateFrom=2026-02-30&sourceDateTo=2026-08-12",
      "sourceDateFrom=2026-08-13&sourceDateTo=2026-08-12",
    ]) {
      const parsed = parseAnalysisFilters(new URLSearchParams(query));
      const scope = resolveAnalysisScope(
        { id: "admin-a", role: "ADMIN", groupId: null, active: true },
        parsed,
        "2026-08-12",
        ["group-a"],
      );

      expect(scope).toMatchObject({
        sourceDateFrom: "2026-07-14",
        sourceDateTo: "2026-08-12",
        filterWarning: "日期筛选无效，已恢复默认日期范围。",
      });
    }
  });

  it("uses the selected month as the authoritative date range", () => {
    expect(parseAnalysisFilters(new URLSearchParams(
      "month=2026-02&sourceDateFrom=bad-date&sourceDateTo=2026-01-31",
    ))).toMatchObject({
      month: "2026-02",
      sourceDateFrom: "2026-02-01",
      sourceDateTo: "2026-02-28",
    });
  });

  it("keeps the explicit sample-insufficient switch in scopes and links", () => {
    const parsed = parseAnalysisFilters(new URLSearchParams("showInsufficient=1"));
    const scope = resolveAnalysisScope(
      { id: "admin-a", role: "ADMIN", groupId: null, active: true },
      parsed,
      "2026-08-12",
      ["group-a"],
    );

    expect(scope.showInsufficient).toBe(true);
    expect(buildAnalysisHref("/anomaly-ranking", scope)).toContain("showInsufficient=1");
    expect(parseAnalysisFilters(new URLSearchParams("showInsufficient=true")).showInsufficient).toBe(false);
  });

  it("keeps valid member period shortcuts in scopes and links", () => {
    const parsed = parseAnalysisFilters(new URLSearchParams("period=mature7"));
    const scope = resolveAnalysisScope(
      { id: "admin-a", role: "ADMIN", groupId: null, active: true },
      parsed,
      "2026-08-14",
      ["group-a"],
    );

    expect(scope.period).toBe("mature7");
    expect(buildAnalysisHref("/anomaly-ranking", scope)).toContain("period=mature7");
  });

  it("drops invalid member period URL values and returns a readable warning", () => {
    const parsed = parseAnalysisFilters(new URLSearchParams("period=yearly"));

    expect(parsed.period).toBeUndefined();
    expect(parsed.filterWarning).toBe("组员统计周期无效，已恢复最近 30 个成熟来源日。");
  });

  it("falls back when a custom period URL omits its required date range", () => {
    const scope = resolveAnalysisScope(
      { id: "admin-a", role: "ADMIN", groupId: null, active: true },
      parseAnalysisFilters(new URLSearchParams("period=custom")),
      "2026-08-14",
      ["group-a"],
    );

    expect(scope.period).toBe("mature30");
    expect(scope.filterWarning).toBe("组员统计周期无效，已恢复最近 30 个成熟来源日。");
  });
});
