import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ values: [] as unknown[] }));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T) => [hookState.values.length ? hookState.values.shift() as T : initial, vi.fn()] as const,
  };
});

import { TeamPerformanceTable } from "../../src/components/analytics/team/TeamPerformanceTable";
import { ChannelQualityTable } from "../../src/components/analytics/channel/ChannelQualityTable";
import { emptyBatchTotals } from "../../src/lib/metrics";

(globalThis as { React?: typeof React }).React = React;

const totals = { ...emptyBatchTotals(), rechargeCents: 1000 };
const rates = { groupRate: null, leaveRate: null, expertRate: null, registrationRate: null, orderRate: null };

describe("team performance layout", () => {
  it("uses the agreed denominators in the summary", () => {
    hookState.values = [];
    const dailyRows = [{
      key: "2026-08-18:group-a", occurredOn: "2026-08-18", groupId: "group-a", groupName: "一组",
      lowAmount: 2, noWs: 1, invalid: 0,
      totals: { ...emptyBatchTotals(), newFans: 20, effectiveFans: 17, replies: 10, groupJoin: 6, groupLeave: 1, expertIntro: 4, registration: 2, orders: 1, rechargeCents: 50_000, withdrawalCents: 5_000 },
    }];
    const html = renderToStaticMarkup(createElement(TeamPerformanceTable, { groupRows: [], memberRows: [], dailyRows, mode: "members", filters: {} }));
    expect(html).toContain("成员表现汇总");
    expect(html).toContain("58.8%"); // 10 个回复 / 17 个有效粉
    expect(html).toContain("60.0%"); // 6 个进群 / 10 个回复
    expect(html).toContain("50.0%"); // 1 个开单 / 2 个注册
    expect(html).toContain("$450.00");
  });

  it("shows the compact member comparison fields", () => {
    hookState.values = [
      { key: "activePeople", direction: "ascending" },
      { key: "recharge", direction: "descending" },
    ];
    const html = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [],
      memberRows: [{ userId: "member-a", name: "成员 A", role: "RECEPTION", groupId: "group-a", groupName: "一组", active: true, totals, rates, sampleState: "INSUFFICIENT", matureNewFans: 0 }],
      mode: "members",
      filters: {},
    }));

    expect(html).toContain("成员表现");
    expect(html).toContain("回复率");
    expect(html).toContain("进群率");
    expect(html).toContain("开单率");
  });

  it("shows group comparison with the five agreed conversion rates", () => {
    hookState.values = [
      { key: "leaveRate", direction: "ascending" },
      { key: "recharge", direction: "descending" },
    ];
    const row = (groupId: string, groupName: string, leaveRate: number | null) => ({
      groupId, groupName, activePeople: 1, totals, rates: { ...rates, leaveRate }, matureNewFans: 20, sampleState: "RANKABLE" as const, averageOrders: 0,
    });
    const html = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [row("none", "甲无分母", null), row("high", "乙高退群", 0.4), row("low", "丙低退群", 0.1)],
      memberRows: [], mode: "groups", filters: {},
    }));

    expect(html).toContain("甲无分母");
    expect(html).toContain("乙高退群");
    expect(html).toContain("丙低退群");
    expect(html).toContain("注册率");
  });

  it("keeps member rows readable without maturity-only columns", () => {
    hookState.values = [
      { key: "recharge", direction: "descending" },
      { key: "leaveRate", direction: "ascending" },
    ];
    const row = (userId: string, name: string, leaveRate: number | null) => ({
      userId, name, role: "RECEPTION" as const, groupId: "group-a", groupName: "一组", active: true, totals, rates: { ...rates, leaveRate }, matureNewFans: 20, sampleState: "RANKABLE" as const,
    });
    const html = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [],
      memberRows: [row("none", "甲无分母", null), row("high", "乙高退群", 0.4), row("low", "丙低退群", 0.1)],
      mode: "members", filters: {},
    }));

    expect(html).toContain("甲无分母");
    expect(html).toContain("乙高退群");
    expect(html).toContain("丙低退群");
    expect(html).not.toContain("D7提交号码样本");
  });

  it("sorts channel leave rates ascending and keeps a zero denominator last", () => {
    hookState.values = [{ key: "leaveRate", direction: "ascending" }];
    const row = (normalizedName: string, displayName: string, leaveRate: number | null) => ({
      normalizedName, displayName, newFans: 20, groupRate: null, registrationRate: null, orderRate: null, rechargePerOrderCents: 0, rankable: true, groupCount: 1, groups: ["一组"], totals, rates: { ...rates, leaveRate },
    });
    const html = renderToStaticMarkup(createElement(ChannelQualityTable, {
      rows: [row("none", "甲无分母", null), row("high", "乙高退群", 0.4), row("low", "丙低退群", 0.1)],
      filters: {},
    }));

    expect(html.indexOf("丙低退群")).toBeLessThan(html.indexOf("乙高退群"));
    expect(html.indexOf("乙高退群")).toBeLessThan(html.indexOf("甲无分母"));
  });
});
