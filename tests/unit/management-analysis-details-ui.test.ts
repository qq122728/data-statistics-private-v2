import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaturityWindowCards } from "../../src/components/analytics/MaturityWindowCards";
import { AnalysisFilters } from "../../src/components/analytics/AnalysisFilters";
import * as analysisStates from "../../src/components/analytics/AnalysisState";
import { OverviewAlerts } from "../../src/components/analytics/overview/OverviewAlerts";
import { OverviewSummary } from "../../src/components/analytics/overview/OverviewSummary";
import * as overviewComponents from "../../src/components/analytics/overview/OverviewSummary";
import { BatchTrackingTable } from "../../src/components/analytics/batch/BatchTrackingTable";
import { ChannelQualityTable } from "../../src/components/analytics/channel/ChannelQualityTable";
import { TeamPerformanceTable } from "../../src/components/analytics/team/TeamPerformanceTable";
import { emptyBatchTotals } from "../../src/lib/metrics";

(globalThis as { React?: typeof React }).React = React;

const emptyTotals = emptyBatchTotals();
const emptyRates = { groupRate: null, leaveRate: null, expertRate: null, registrationRate: null, orderRate: null };

describe("management analysis detail components", () => {
  it("provides a reusable query-error state with an in-place reload action", () => {
    const AnalysisErrorState = (analysisStates as unknown as {
      AnalysisErrorState?: (props: { onReload: () => void }) => React.ReactNode;
    }).AnalysisErrorState;
    expect(AnalysisErrorState).toBeTypeOf("function");
    if (!AnalysisErrorState) return;

    const html = renderToStaticMarkup(createElement(AnalysisErrorState, { onReload: () => undefined }));
    expect(html).toContain("查询数据时出错");
    expect(html).toContain("重新加载");
    expect(html).toContain("<button");
  });

  it("distinguishes pending maturity from a mature zero-denominator sample and shows key conversion rates", () => {
    const html = renderToStaticMarkup(createElement(MaturityWindowCards, {
      d7: { state: "PENDING", totals: emptyTotals, rates: emptyRates },
      d14: { state: "MATURE", totals: emptyTotals, rates: emptyRates },
    }));

    expect(html).toContain("尚未达到 D7");
    expect(html).toContain("D14添加数据样本");
    expect(html).toContain("进群率");
    expect(html).toContain("注册率");
    expect(html).toContain("开单率");
    expect(html.match(/分母为 0/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps only primary controls above a shared more-filters disclosure", () => {
    const html = renderToStaticMarkup(createElement(AnalysisFilters, {
      action: "/dashboard",
      visible: { group: true, member: true, channel: true, dates: true, includeInactive: true },
      primary: ["group", "dates"],
      options: {
        groups: [{ id: "group-a", name: "一组" }],
        members: [{ id: "member-a", name: "成员 A" }],
        channels: [{ normalizedName: "抖音", name: "抖音" }],
      },
      values: { sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-12" },
    }));
    const [primary, more = ""] = html.split("<details");

    expect(html).toContain("更多筛选");
    expect(primary).toContain("小组");
    expect(primary).toContain("来源开始");
    expect(primary).not.toContain("人员");
    expect(primary).not.toContain("渠道");
    expect(more).toContain("人员");
    expect(more).toContain("渠道");
    expect(more).toContain("包含停用人员");
  });

  it("offers both channel and exact-batch drill-downs for a funnel anomaly", () => {
    const alert = { batchId: "batch-a", memberId: "member-a", normalizedName: "抖音直播", channelName: "抖音直播", memberName: "成员 A", reason: "注册大于推专家", count: 1 };
    const html = renderToStaticMarkup(createElement(OverviewAlerts, {
      overview: {
        hasData: false, totals: emptyTotals,
        summary: { newFans: 0, orders: 0, rechargeCents: 0, orderRate: null }, trend: [], largestDrop: null,
        alerts: { unconfirmed: [], noRecords3Days: [], replyWithoutFans: [], funnelAnomalies: [alert], excessiveLeaves: [] },
      },
      filters: { sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-12" },
    }));

    expect(html).toContain("/channel-analysis?normalizedName=%E6%8A%96%E9%9F%B3%E7%9B%B4%E6%92%AD&amp;sourceDateFrom=2026-08-01&amp;sourceDateTo=2026-08-12");
    expect(html).toContain("/batch-tracking?batchId=batch-a&amp;memberId=member-a&amp;normalizedName=%E6%8A%96%E9%9F%B3%E7%9B%B4%E6%92%AD");
  });

  it("shows historical group identity only for admins and preserves list filters in the detail link", () => {
    const row = {
      key: "batch-a:member-a", batchId: "batch-a", memberId: "member-a", sourceDate: "2026-07-01", normalizedName: "抖音", channelName: "抖音", memberName: "成员 A", groupId: "group-a", groupName: "一组", ageDays: 42, ageLabel: "D15+" as const,
      totals: { ...emptyTotals, newFans: 25, orders: 2, rechargeCents: 9000 }, currentStage: "ORDER" as const,
      largestDrop: { from: "NEW_FANS" as const, to: "REPLIES" as const, lost: 7 }, status: "ORDERED" as const,
    };
    const filters = { groupId: "group-a", normalizedName: "抖音", sourceDateFrom: "2026-06-01", sourceDateTo: "2026-08-12" };
    const admin = renderToStaticMarkup(createElement(BatchTrackingTable, { rows: [row], filters, showGroup: true }));
    const lead = renderToStaticMarkup(createElement(BatchTrackingTable, { rows: [row], filters, showGroup: false }));

    expect(admin).toContain("一组");
    expect(lead).not.toContain("一组");
    expect(admin).toContain("/batch-tracking/batch-a?groupId=group-a&amp;memberId=member-a&amp;normalizedName=%E6%8A%96%E9%9F%B3&amp;sourceDateFrom=2026-06-01&amp;sourceDateTo=2026-08-12");
    expect((admin.match(/<th(?:\s|>)/g) ?? [])).toHaveLength(7);
    expect(admin).toContain("添加数据");
    expect(admin).toContain("最大卡点");
    expect(admin).not.toContain("入金");
  });

  it("shows the agreed summary columns instead of maturity-only ranking", () => {
    const rows = [
      { groupId: "small", groupName: "小样本组", activePeople: 1, totals: { ...emptyTotals, rechargeCents: 999_000 }, rates: { ...emptyRates, orderRate: 1 }, matureNewFans: 1, sampleState: "INSUFFICIENT" as const, averageOrders: 1 },
      { groupId: "rankable", groupName: "可排名组", activePeople: 1, totals: { ...emptyTotals, rechargeCents: 100 }, rates: { ...emptyRates, orderRate: 0.1 }, matureNewFans: 20, sampleState: "RANKABLE" as const, averageOrders: 1 },
    ];
    const html = renderToStaticMarkup(createElement(TeamPerformanceTable, { groupRows: rows, memberRows: [], mode: "groups", filters: {} }));

    expect(html).toContain("成员表现汇总");
    expect(html).toContain("回复率");
    expect(html).not.toContain("D7提交号码样本");
  });

  it("shows the agreed daily metrics and keeps channel metrics available", () => {
    const totals = {
      ...emptyTotals,
      newFans: 101,
      replies: 102,
      groupJoin: 103,
      groupLeave: 104,
      inGroup: -1,
      expertIntro: 105,
      registration: 106,
      orders: 107,
      rechargeCents: 10_809,
    };
    const dailyRows = [{ key: "2026-08-01:group-a", occurredOn: "2026-08-01", groupId: "group-a", groupName: "一组", lowAmount: 2, noWs: 3, totals }];
    const groupHtml = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [{ groupId: "group-a", groupName: "一组", activePeople: 2, totals, rates: emptyRates, matureNewFans: 88, sampleState: "RANKABLE" as const, averageOrders: 53.5 }],
      memberRows: [],
      dailyRows,
      mode: "groups",
      filters: {},
    }));
    const memberHtml = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [],
      memberRows: [{ userId: "member-a", name: "成员 A", role: "RECEPTION" as const, groupId: "group-a", groupName: "一组", active: true, totals, rates: emptyRates, matureNewFans: 88, sampleState: "RANKABLE" as const }],
      dailyRows,
      mode: "members",
      filters: {},
    }));
    const channelHtml = renderToStaticMarkup(createElement(ChannelQualityTable, {
      rows: [{ normalizedName: "抖音", displayName: "抖音", newFans: totals.newFans, currentInGroup: 0, groupRate: null, registrationRate: null, orderRate: null, rechargePerOrderCents: 107, rankable: true, groupCount: 1, groups: ["一组"], totals, rates: emptyRates }],
      filters: {},
    }));

    for (const html of [groupHtml, memberHtml]) {
      for (const label of ["添加", "低金额", "无 WS", "有效数据", "回复", "进群", "退群", "推专家", "注册", "开单", "入金", "出金", "净业绩"]) expect(html).toContain(label);
      for (const value of ["101", "102", "103", "104", "105", "106", "107", "$108.09"]) expect(html).toContain(value);
    }
    for (const label of ["添加数据", "撞粉", "低金额", "无 WS 号码", "有效数据"]) expect(channelHtml).toContain(label);
    expect(channelHtml).not.toContain("人工无效");
    for (const label of ["渠道数据", "转化结果", "每开一单平均入金"]) expect(channelHtml).toContain(label);
    expect(channelHtml).toContain("channel-analysis-table");
    expect(channelHtml).not.toContain("每添加数据入金");
  });

  it("keeps only the three business deduction categories inside the resource channel table", () => {
    const html = renderToStaticMarkup(createElement(ChannelQualityTable, {
      rows: [{
        normalizedName: "resource-channel", displayName: "短信渠道", newFans: 20, currentInGroup: 0, submitted: 20, effective: 14,
        duplicate: 2, lowAmount: 1, noWs: 2,
        groupRate: null, registrationRate: null, orderRate: null, rechargePerOrderCents: 0,
        rankable: true, groupCount: 1, groups: ["一组"], totals: { ...emptyTotals, newFans: 20, effectiveFans: 14, duplicateFans: 2 }, rates: emptyRates,
      }],
      filters: {}, resourceMode: true,
    }));

    for (const label of ["渠道表现", "撞粉", "低金额", "无 WS 号码"]) expect(html).toContain(label);
    expect(html).not.toContain("人工无效");
    for (const value of [">2</td>", ">1</td>", ">14</td>"]) expect(html).toContain(value);
    expect(html).not.toContain("其他无效率");
  });

  it("keeps the company group summary on the data-summary subpage", () => {
    const dailyRows = [{ key: "2026-08-01:group-a", occurredOn: "2026-08-01", groupId: "group-a", groupName: "一组", lowAmount: 1, noWs: 2, totals: { ...emptyTotals, newFans: 10, effectiveFans: 7 } }];
    const html = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [{ groupId: "group-a", groupName: "一组", activePeople: 3, totals: emptyTotals, rates: emptyRates, matureNewFans: 0, sampleState: "INSUFFICIENT" as const, averageOrders: 0 }],
      memberRows: [], dailyRows, mode: "groups", filters: {}, showPeriodGroupSummary: true,
    }));

    expect(html).toContain("本期小组数据汇总");
    expect(html.indexOf("成员表现汇总")).toBeLessThan(html.indexOf("本期小组数据汇总"));
    expect(html).not.toContain("<h2 class=\"panel-title\">每日明细</h2>");
  });

  it("shows the new five conversion rates and keeps channel sorting", () => {
    const leaveRates = { ...emptyRates, leaveRate: 0.25 };
    const groupHtml = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [{ groupId: "group-a", groupName: "一组", activePeople: 2, totals: emptyTotals, rates: leaveRates, matureNewFans: 88, sampleState: "RANKABLE" as const, averageOrders: 1 }],
      memberRows: [], dailyRows: [{ key: "2026-08-01:group-a", occurredOn: "2026-08-01", groupId: "group-a", groupName: "一组", lowAmount: 0, noWs: 0, totals: { ...emptyTotals, groupJoin: 4, groupLeave: 1, abnormalGroupLeave: 1 } }], mode: "groups", filters: {},
    }));
    const memberHtml = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [],
      memberRows: [{ userId: "member-a", name: "成员 A", role: "RECEPTION" as const, groupId: "group-a", groupName: "一组", active: true, totals: emptyTotals, rates: leaveRates, matureNewFans: 88, sampleState: "RANKABLE" as const }],
      dailyRows: [{ key: "2026-08-01:group-a", occurredOn: "2026-08-01", groupId: "group-a", groupName: "一组", lowAmount: 0, noWs: 0, totals: { ...emptyTotals, groupJoin: 4, groupLeave: 1, abnormalGroupLeave: 1 } }], mode: "members", filters: {},
    }));
    const channelHtml = renderToStaticMarkup(createElement(ChannelQualityTable, {
      rows: [{ normalizedName: "抖音", displayName: "抖音", newFans: 88, currentInGroup: 0, groupRate: null, registrationRate: null, orderRate: null, rechargePerOrderCents: 0, rankable: true, groupCount: 1, groups: ["一组"], totals: emptyTotals, rates: leaveRates }],
      filters: {},
    }));

    for (const html of [groupHtml, memberHtml]) expect(html).toContain("25.0%");
    expect(groupHtml).toContain("回复率");
    expect(memberHtml).toContain("开单率");
    expect(channelHtml).toContain('aria-label="按异常退群率排序"');
  });

  it("distinguishes truly empty overview and team results from real zero values", () => {
    const overview = renderToStaticMarkup(createElement(OverviewSummary, {
      overview: {
        hasData: false,
        totals: emptyTotals,
        summary: { newFans: 0, orders: 0, rechargeCents: 0, orderRate: null },
        trend: [],
        largestDrop: null,
        alerts: { unconfirmed: [], noRecords3Days: [], replyWithoutFans: [], funnelAnomalies: [], excessiveLeaves: [] },
      },
    }));
    const team = renderToStaticMarkup(createElement(TeamPerformanceTable, { groupRows: [], memberRows: [], mode: "groups", filters: {}, view: "daily" }));

    expect(overview).toContain("没有可汇总的数据");
    expect(overview).not.toContain("management-metric-grid");
    expect(team).toContain("当前日期范围还没有团队数据");
    expect(team).toContain("<table");
  });

  it("offers a working global-funnel drill-down from the overview largest drop", () => {
    const html = renderToStaticMarkup(createElement(OverviewSummary, {
      overview: {
        hasData: true,
        totals: { ...emptyTotals, newFans: 30, replies: 20, groupJoin: 10, orders: 2 },
        summary: { newFans: 30, orders: 2, rechargeCents: 0, orderRate: 2 / 30 },
        trend: [],
        largestDrop: { from: "NEW_FANS", to: "REPLIES", lost: 10 },
        alerts: { unconfirmed: [], noRecords3Days: [], replyWithoutFans: [], funnelAnomalies: [], excessiveLeaves: [] },
      },
    }));

    expect(html).toContain("<button");
    expect(html).toContain("查看完整漏斗");

    const OverviewFunnelDrawer = (overviewComponents as unknown as {
      OverviewFunnelDrawer?: (props: { open: boolean; onClose: () => void; totals: typeof emptyTotals; largestDrop: { from: "NEW_FANS"; to: "REPLIES"; lost: number } }) => React.ReactNode;
    }).OverviewFunnelDrawer;
    expect(OverviewFunnelDrawer).toBeTypeOf("function");
    if (!OverviewFunnelDrawer) return;
    const drawer = renderToStaticMarkup(createElement(OverviewFunnelDrawer, {
      open: true,
      onClose: () => undefined,
      totals: { ...emptyTotals, newFans: 30, replies: 20 },
      largestDrop: { from: "NEW_FANS", to: "REPLIES", lost: 10 },
    }));
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain("全局转化漏斗");
    expect(drawer).toContain("添加数据");
    expect(drawer).toContain("回复");
  });

  it("exposes sortable analysis tables, textual statuses, and shared desktop layout hooks", () => {
    const channel = {
      normalizedName: "抖音", displayName: "抖音", newFans: 25, currentInGroup: 0, groupRate: 0.4, registrationRate: 0.2, orderRate: 0.1,
      rechargePerOrderCents: 120, rankable: true, groupCount: 1, groups: ["一组"], totals: emptyTotals, rates: emptyRates,
    };
    const batch = {
      key: "batch-a:member-a", batchId: "batch-a", memberId: "member-a", sourceDate: "2026-07-01", normalizedName: "抖音", channelName: "抖音", memberName: "成员 A", groupId: "group-a", groupName: "一组", ageDays: 42, ageLabel: "D15+" as const,
      totals: emptyTotals, currentStage: "NEW_FANS" as const, largestDrop: null, status: "STALLED" as const,
    };
    const channelHtml = renderToStaticMarkup(createElement(ChannelQualityTable, { rows: [channel], filters: {} }));
    const batchHtml = renderToStaticMarkup(createElement(BatchTrackingTable, { rows: [batch], filters: {}, showGroup: true }));
    const member = {
      userId: "member-a", name: "成员 A", role: "RECEPTION" as const, groupId: "group-a", groupName: "一组", active: true,
      totals: { ...emptyTotals, rechargeCents: 1000 }, rates: emptyRates, sampleState: "INSUFFICIENT" as const, matureNewFans: 0,
    };
    const teamHtml = renderToStaticMarkup(createElement(TeamPerformanceTable, { groupRows: [], memberRows: [member], mode: "members", filters: {} }));
    const inactiveHtml = renderToStaticMarkup(createElement(TeamPerformanceTable, { groupRows: [], memberRows: [{ ...member, active: false }], mode: "members", filters: {} }));
    const groupHtml = renderToStaticMarkup(createElement(TeamPerformanceTable, {
      groupRows: [{ groupId: "group-a", groupName: "一组", activePeople: 1, totals: emptyTotals, rates: emptyRates, matureNewFans: 0, sampleState: "INSUFFICIENT" as const, averageOrders: 0 }],
      memberRows: [], mode: "groups", filters: {},
    }));

    expect(channelHtml).toContain('aria-sort="descending"');
    expect(teamHtml).toContain("成员表现汇总");
    expect(groupHtml).toContain("开单率");
    expect(channelHtml).toContain("analysis-grid");
    expect(batchHtml).toContain("analysis-status");
    expect(batchHtml).toContain("停滞");
    expect(batchHtml).toContain("analysis-grid");
  });
});
