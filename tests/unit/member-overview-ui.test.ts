import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisFilters } from "../../src/components/analytics/AnalysisFilters";
import { ConversionRankingTable } from "../../src/components/analytics/member/ConversionRankingTable";
import { MemberOverviewTable } from "../../src/components/analytics/member/MemberOverviewTable";
import { PerformanceRankings } from "../../src/components/analytics/member/PerformanceRankings";
import { RiskAlerts } from "../../src/components/analytics/member/RiskAlerts";
import type { MemberOverviewRow } from "../../src/lib/analytics/member-overview";
import { defaultRiskSettings } from "../../src/lib/risk-settings";
import { emptyBatchTotals } from "../../src/lib/metrics";

(globalThis as { React?: typeof React }).React = React;

const row = (
  overrides: Partial<MemberOverviewRow> = {},
): MemberOverviewRow => ({
  member: { id: "member-a", name: "王小明", active: true, role: "RECEPTION" },
  group: { id: "group-a", name: "一组" },
  stage: "FORMAL",
  totals: {
    ...emptyBatchTotals(),
    newFans: 120,
    effectiveFans: 100,
    replies: 60,
    groupJoin: 40,
    groupLeave: 4,
    inGroup: 36,
    expertIntro: 20,
    registration: 10,
    orders: 8,
    rechargeCents: 50_000,
  },
  effectiveRate: 100 / 120,
  orderRate: 8 / 120,
  rechargePerEffectiveFanCents: 500,
  netPerformanceCents: 50_000,
  adjustedEfficiency: 1.1,
  adjustedState: "READY",
  trend: 0.1,
  ...overrides,
});

describe("member overview UI contracts", () => {
  it("offers mature periods, all common filters, and a fixed group label for leads", () => {
    const admin = renderToStaticMarkup(
      createElement(AnalysisFilters, {
        action: "/anomaly-ranking",
        visible: {
          period: true,
          group: true,
          channel: true,
          member: true,
          dates: true,
          includeInactive: true,
        },
        primary: ["period", "group", "member"],
        options: {
          groups: [{ id: "group-a", name: "一组" }],
          channels: [{ normalizedName: "抖音", name: "抖音" }],
          members: [{ id: "member-a", name: "王小明" }],
        },
        values: {
          period: "mature7",
          sourceDateFrom: "2026-08-01",
          sourceDateTo: "2026-08-07",
          includeInactive: true,
        },
        preserve: { tab: "risk" },
      }),
    );
    const lead = renderToStaticMarkup(
      createElement(AnalysisFilters, {
        action: "/anomaly-ranking",
        visible: {
          period: true,
          channel: true,
          member: true,
          dates: true,
          includeInactive: true,
        },
        primary: ["period", "channel", "member"],
        options: {},
        values: {
          period: "mature30",
          sourceDateFrom: "2026-07-01",
          sourceDateTo: "2026-07-30",
          includeInactive: false,
        },
        fixedGroupName: "一组",
        preserve: { tab: "overview" },
      }),
    );

    for (const value of ["mature7", "mature30", "custom"])
      expect(admin).toContain(`value="${value}"`);
    for (const label of [
      "小组",
      "渠道",
      "人员",
      "包含停用人员",
      "来源开始",
      "来源结束",
    ])
      expect(admin).toContain(label);
    expect(admin).toContain('name="tab" value="risk"');
    expect(lead).toContain("固定小组");
    expect(lead).toContain("一组");
    expect(lead).not.toContain('aria-label="小组"');
  });

  it("keeps the overview decision columns compact and renders mobile member cards", () => {
    const html = renderToStaticMarkup(
      createElement(MemberOverviewTable, {
        rows: [row()],
        showGroup: true,
        sort: "net",
        query: { tab: "overview", period: "mature30" },
        role: "ADMIN",
      }),
    );

    for (const heading of [
      "净业绩排名",
      "组员 / 小组",
      "有效数据",
      "入群数",
      "进群率",
      "推专家",
      "注册",
      "开单",
      "入金",
      "出金",
      "净业绩",
    ])
      expect(html).toContain(heading);
    expect(html).toContain('data-testid="member-desktop-table"');
    expect(html).toContain('data-testid="member-mobile-card"');
    expect(html).toContain("查看详情");
  });

  it("renders three explainable performance rankings without a composite score", () => {
    const training = row({
      member: {
        id: "training",
        name: "培训成员",
        active: true,
        role: "RECEPTION",
      },
      stage: "TRAINING",
    });
    const invalid = row({
      member: {
        id: "invalid",
        name: "错误数据成员",
        active: true,
        role: "RECEPTION",
      },
      adjustedState: "DATA_INVALID",
      adjustedEfficiency: null,
    });
    const empty = row({
      member: { id: "empty", name: "无数据成员", active: true, role: "RECEPTION" },
      totals: emptyBatchTotals(),
      effectiveRate: null,
      orderRate: null,
      rechargePerEffectiveFanCents: null,
      adjustedState: "INSUFFICIENT_SAMPLE",
      adjustedEfficiency: null,
      trend: null,
    });
    const html = renderToStaticMarkup(
      createElement(PerformanceRankings, {
        rows: [row(), training, invalid, empty],
        showGroup: true,
        role: "ADMIN",
      }),
    );

    for (const title of ["净业绩贡献榜", "渠道校正效率榜", "稳定进步榜"])
      expect(html).toContain(title);
    for (const state of [
      "培训期·不正式排名",
      "数据待核实",
      "无数据",
    ])
      expect(html).toContain(state);
    expect(html).toContain("连续改善天数");
    expect(html).not.toContain("综合分");
  });

  it("sorts one conversion metric at a time, puts lower leave rate first, and explains a zero denominator", () => {
    const lowLeave = row({
      member: { id: "low", name: "低退群", active: true, role: "RECEPTION" },
      totals: { ...row().totals, groupLeave: 1 },
    });
    const highLeave = row({
      member: { id: "high", name: "高退群", active: true, role: "RECEPTION" },
      totals: { ...row().totals, groupLeave: 8 },
    });
    const small = row({
      member: { id: "small", name: "小样本", active: true, role: "RECEPTION" },
      totals: { ...row().totals, groupJoin: 10, groupLeave: 1 },
    });
    const training = row({
      member: {
        id: "training",
        name: "培训成员",
        active: true,
        role: "RECEPTION",
      },
      stage: "TRAINING",
    });
    const zero = row({
      member: { id: "zero", name: "零分母", active: true, role: "RECEPTION" },
      totals: { ...emptyBatchTotals(), rechargeCents: 1000 },
      rechargePerEffectiveFanCents: null,
      adjustedEfficiency: null,
      adjustedState: "INSUFFICIENT_SAMPLE",
    });
    const html = renderToStaticMarkup(
      createElement(ConversionRankingTable, {
        rows: [highLeave, zero, small, training, lowLeave],
        metric: "leaveRate",
        showGroup: false,
        role: "LEAD",
        riskSettings: defaultRiskSettings,
      }),
    );

    for (const option of [
      "回复率",
      "进群率",
      "异常退群率",
      "进群后推专家率",
      "推专家后注册率",
      "开单率",
      "每有效数据入金",
      "渠道校正效率",
    ])
      expect(html).toContain(option);
    expect(html.indexOf("低退群")).toBeLessThan(html.indexOf("高退群"));
    expect(html).toContain("样本不足");
    expect(html).toContain("培训期·不正式排名");
    expect(html).toContain("—");
    expect(html).toContain('title="缺少有效分母"');
  });

  it("separates performance, financial, and data risks and never exposes admin confirmation to leads", () => {
    const performance = row({ adjustedEfficiency: 0.5, trend: -0.2 });
    const trainingLow = row({
      member: {
        id: "training-low",
        name: "培训低样本",
        active: true,
        role: "RECEPTION",
      },
      stage: "TRAINING",
      adjustedEfficiency: 0.1,
      trend: -0.8,
    });
    const financial = row({
      member: { id: "loss", name: "亏损成员", active: true, role: "RECEPTION" },
      netPerformanceCents: -40_000,
    });
    const invalid = row({
      member: { id: "invalid", name: "数据异常", active: true, role: "RECEPTION" },
      adjustedEfficiency: null,
      adjustedState: "DATA_INVALID",
    });
    const noData = row({
      member: {
        id: "no-data",
        name: "无数据成员",
        active: true,
        role: "RECEPTION",
      },
      totals: emptyBatchTotals(),
      adjustedEfficiency: null,
      adjustedState: "INSUFFICIENT_PEERS",
    });
    const admin = renderToStaticMarkup(
      createElement(RiskAlerts, {
        rows: [performance, trainingLow, financial, invalid, noData],
        role: "ADMIN",
        riskSettings: defaultRiskSettings,
      }),
    );
    const lead = renderToStaticMarkup(
      createElement(RiskAlerts, {
        rows: [performance, trainingLow, financial, invalid, noData],
        role: "LEAD",
        riskSettings: defaultRiskSettings,
      }),
    );

    for (const title of ["表现风险", "财务风险", "数据风险"])
      expect(admin).toContain(title);
    for (const label of [
      "正式期",
      "有效粉",
      "数据待核实",
      "无数据",
      "查看证据",
    ])
      expect(admin).toContain(label);
    expect(admin).toContain("人工确认在证据详情中操作");
    expect(admin).not.toContain("培训低样本");
    expect(lead).toContain("安排辅导");
    expect(lead).not.toContain("人工确认在证据详情中操作");
  });
});
