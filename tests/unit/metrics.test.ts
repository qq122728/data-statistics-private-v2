import { describe, expect, it } from "vitest";
import {
  addBatchTotals,
  calculateBatchTotals,
  calculateChannelComparisons,
  calculateConversionRates,
  calculateNormalizedChannelComparisons,
  emptyBatchTotals,
  formatMetricEventValue,
  formatConversionNote,
  metricKindLabels,
} from "../../src/lib/metrics";

describe("funnel metrics", () => {
  it("provides one complete empty total and aggregates every total field", () => {
    const empty = emptyBatchTotals();
    expect(empty).toEqual({
      newFans: 0,
      replies: 0,
      groupJoin: 0,
      groupLeave: 0,
      abnormalGroupLeave: 0,
      expertIntro: 0,
      registration: 0,
      orders: 0,
      rechargeCents: 0,
      effectiveFans: 0,
      noNumber: 0,
      duplicateFans: 0,
      withdrawalCents: 0,
      channelPerformanceCents: 0,
    });

    expect(addBatchTotals(empty, {
      newFans: 1,
      replies: 2,
      groupJoin: 3,
      groupLeave: 4,
      abnormalGroupLeave: 2,
      expertIntro: 5,
      registration: 6,
      orders: 7,
      rechargeCents: 800,
      effectiveFans: 9,
      noNumber: 10,
      duplicateFans: 11,
      withdrawalCents: 1_200,
      channelPerformanceCents: 1_300,
    })).toEqual({
      newFans: 1,
      replies: 2,
      groupJoin: 3,
      groupLeave: 4,
      abnormalGroupLeave: 2,
      expertIntro: 5,
      registration: 6,
      orders: 7,
      rechargeCents: 800,
      effectiveFans: 9,
      noNumber: 10,
      duplicateFans: 11,
      withdrawalCents: 1_200,
      channelPerformanceCents: 1_300,
    });
  });

  it("labels every metric kind and formats all amount events as money", () => {
    expect(metricKindLabels).toEqual({
      NEW_FANS: "添加数据",
      EFFECTIVE_FANS: "有效数据",
      NO_NUMBER: "无 WS 号码",
      DUPLICATE_FANS: "撞粉",
      REPLIES: "回复",
      GROUP_JOIN: "入群",
      GROUP_LEAVE: "退群",
      ABNORMAL_GROUP_LEAVE: "异常退群",
      EXPERT_INTRO: "推专家",
      REGISTRATION: "注册",
      ORDER: "开单",
      RECHARGE: "入金",
      WITHDRAWAL: "出金",
      CHANNEL_PERFORMANCE: "通道业绩",
    });
    expect(formatMetricEventValue({ kind: "RECHARGE", amountCents: 123 })).toBe("$1.23");
    expect(formatMetricEventValue({ kind: "WITHDRAWAL", amountCents: 456 })).toBe("$4.56");
    expect(formatMetricEventValue({ kind: "CHANNEL_PERFORMANCE", amountCents: 789 })).toBe("$7.89");
    expect(formatMetricEventValue({ kind: "EFFECTIVE_FANS", quantity: 12 })).toBe("12");
  });

  it("returns null for zero denominators", () => {
    const totals = calculateBatchTotals([
      { kind: "GROUP_JOIN", quantity: 6 },
      { kind: "GROUP_LEAVE", quantity: 2 },
      { kind: "ABNORMAL_GROUP_LEAVE", quantity: 1 },
    ]);

    expect(totals.abnormalGroupLeave).toBe(1);
    expect(calculateConversionRates(totals).leaveRate).toBeCloseTo(1 / 4);
    expect(calculateConversionRates(totals).groupRate).toBeNull();
  });

  it("aggregates fan statuses and financial metric events", () => {
    expect(calculateBatchTotals([
      { kind: "EFFECTIVE_FANS", quantity: 12 },
      { kind: "NO_NUMBER", quantity: 3 },
      { kind: "DUPLICATE_FANS", quantity: 2 },
      { kind: "WITHDRAWAL", amountCents: 400 },
      { kind: "CHANNEL_PERFORMANCE", amountCents: 600 },
    ])).toMatchObject({
      effectiveFans: 12,
      noNumber: 3,
      duplicateFans: 2,
      withdrawalCents: 400,
      channelPerformanceCents: 600,
    });
  });

  it("calculates the requested funnel ratios", () => {
    const totals = {
      newFans: 100,
      groupJoin: 20,
      groupLeave: 4,
      abnormalGroupLeave: 4,
      expertIntro: 5,
      registration: 2,
      orders: 1,
      replies: 40,
      rechargeCents: 0,
      effectiveFans: 80,
      noNumber: 0,
      duplicateFans: 0,
      withdrawalCents: 0,
      channelPerformanceCents: 0,
    };

    expect(calculateConversionRates(totals)).toMatchObject({
      replyRate: 0.5,
      groupRate: 0.25,
      leaveRate: 0.25,
      expertRate: 0.25,
      registrationRate: 0.4,
      orderRate: 0.5,
    });
  });

  it("combines cohort totals by channel before calculating channel conversion rates", () => {
    const channelOne = { id: "channel-1", name: "视频号" };
    const channelTwo = { id: "channel-2", name: "广告" };
    const emptyTotals = {
      replies: 0,
      groupLeave: 0,
      expertIntro: 0,
      registration: 0,
      orders: 0,
      rechargeCents: 0,
      effectiveFans: 0,
      noNumber: 0,
      duplicateFans: 0,
      withdrawalCents: 0,
      channelPerformanceCents: 0,
    };

    const comparisons = calculateChannelComparisons([
      { group: { id: "group-1", name: "一组" }, channel: channelOne, totals: { ...emptyTotals, newFans: 100, effectiveFans: 80, replies: 50, groupJoin: 25 } },
      { group: { id: "group-1", name: "一组" }, channel: channelOne, totals: { ...emptyTotals, newFans: 50, effectiveFans: 40, replies: 20, groupJoin: 10 } },
      { group: { id: "group-1", name: "一组" }, channel: channelTwo, totals: { ...emptyTotals, newFans: 20, effectiveFans: 20, replies: 20, groupJoin: 10 } },
    ]);

    expect(comparisons).toMatchObject([
      { channel: channelOne, totals: { newFans: 150, groupJoin: 35 }, rates: { groupRate: 35 / 120 } },
      { channel: channelTwo, totals: { newFans: 20, groupJoin: 10 }, rates: { groupRate: 0.5 } },
    ]);
  });

  it("keeps new financial and fan-status totals when combining channel cohorts", () => {
    const comparison = calculateChannelComparisons([
      {
        group: { id: "group-1", name: "一组" },
        channel: { id: "channel-1", name: "视频号" },
        totals: {
          newFans: 0, replies: 0, groupJoin: 0, groupLeave: 0, expertIntro: 0, registration: 0, orders: 0, rechargeCents: 0,
          effectiveFans: 4, noNumber: 1, duplicateFans: 2, withdrawalCents: 100, channelPerformanceCents: 250,
        },
      },
      {
        group: { id: "group-1", name: "一组" },
        channel: { id: "channel-1", name: "视频号" },
        totals: {
          newFans: 0, replies: 0, groupJoin: 0, groupLeave: 0, expertIntro: 0, registration: 0, orders: 0, rechargeCents: 0,
          effectiveFans: 3, noNumber: 2, duplicateFans: 1, withdrawalCents: 50, channelPerformanceCents: 150,
        },
      },
    ]);

    expect(comparison[0].totals).toMatchObject({
      effectiveFans: 7,
      noNumber: 3,
      duplicateFans: 3,
      withdrawalCents: 150,
      channelPerformanceCents: 400,
    });
  });

  it("keeps channels with the same id in different groups separate", () => {
    const totals = {
      newFans: 10,
      replies: 0,
      groupJoin: 2,
      groupLeave: 0,
      expertIntro: 0,
      registration: 0,
      orders: 0,
      rechargeCents: 0,
      effectiveFans: 0,
      noNumber: 0,
      duplicateFans: 0,
      withdrawalCents: 0,
      channelPerformanceCents: 0,
    };

    const comparisons = calculateChannelComparisons([
      { group: { id: "group-1", name: "一组" }, channel: { id: "shared", name: "视频号" }, totals },
      { group: { id: "group-2", name: "二组" }, channel: { id: "shared", name: "视频号" }, totals },
    ]);

    expect(comparisons).toHaveLength(2);
    expect(comparisons.map((item) => item.group.name)).toEqual(["一组", "二组"]);
  });

  it("turns a conversion into the requested plain-language note", () => {
    expect(formatConversionNote(20, 100, "粉", "入群")).toBe("平均 5 个粉产生 1 个入群");
    expect(formatConversionNote(2, 5, "推专家", "注册")).toBe("平均 2.5 个推专家产生 1 个注册");
    expect(formatConversionNote(0, 100, "粉", "开单")).toBe("暂无可计算备注");
  });

  it("combines normalized channel names across groups for an all-group report", () => {
    const emptyTotals = {
      replies: 0,
      groupJoin: 0,
      groupLeave: 0,
      expertIntro: 0,
      registration: 0,
      orders: 0,
      rechargeCents: 0,
      effectiveFans: 0,
      noNumber: 0,
      duplicateFans: 0,
      withdrawalCents: 0,
      channelPerformanceCents: 0,
    };

    const comparisons = calculateNormalizedChannelComparisons([
      { group: { id: "group-1", name: "一组" }, channel: { id: "channel-1", name: " 抖音直播 " }, totals: { ...emptyTotals, newFans: 10 } },
      { group: { id: "group-2", name: "二组" }, channel: { id: "channel-2", name: "抖音直播" }, totals: { ...emptyTotals, newFans: 15 } },
    ]);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]).toMatchObject({
      group: { id: "multi", name: "多个小组" },
      channel: { name: "抖音直播" },
      totals: { newFans: 25 },
    });
  });
});
