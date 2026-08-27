import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemberOverviewSummary } from "../../src/components/analytics/member/MemberOverviewSummary";
import { MemberOverviewTabs } from "../../src/components/analytics/member/MemberOverviewTabs";

(globalThis as { React?: typeof React }).React = React;

describe("member overview page shell", () => {
  it("keeps report filters but clears the selected member when switching roles", () => {
    const html = renderToStaticMarkup(
      createElement(MemberOverviewTabs, {
        activeTab: "operator",
        query: {
          period: "mature7",
          groupId: "group-a",
          memberId: "member-a",
          normalizedName: "抖音",
          includeInactive: "1",
        },
      }),
    );

    for (const [label, tab] of [
      ["接粉成员", "reception"],
      ["炒群成员", "operator"],
      ["专家成员", "expert"],
    ]) {
      expect(html).toContain(label);
      expect(html).toContain(`tab=${tab}`);
    }
    expect(html).not.toContain("风险预警");
    expect(html).toContain("period=mature7");
    expect(html).toContain("groupId=group-a");
    expect(html).toMatch(/memberId=member-a[^\"]*tab=operator/);
    expect(html).toContain("tab=reception");
    expect(html).toContain("tab=expert");
    expect(html).not.toContain("tab=reception&amp;memberId=member-a");
    expect(html).not.toContain("tab=expert&amp;memberId=member-a");
    expect(html).toContain("normalizedName=%E6%8A%96%E9%9F%B3");
    expect(html).toContain("includeInactive=1");
    expect(html).toContain('aria-current="page"');
  });

  it("summarizes mature samples and distinguishes pending pricing from zero money", () => {
    const html = renderToStaticMarkup(
      createElement(MemberOverviewSummary, {
        sourceDayCount: 30,
        summary: {
          effectiveFans: 120,
          rechargeCents: 50_000,
          costCents: null,
          profitCents: null,
          attentionMemberCount: 2,
          matureBatchCount: 4,
          observingBatchCount: 1,
          rankedMemberCount: 3,
        },
        pendingPriceChannels: [
          { id: "channel-a", groupId: "group-a", name: "待定价渠道" },
        ],
      }),
    );

    for (const label of [
      "有效数据样本",
      "入金",
      "数据成本",
      "团队计入业绩",
      "需要关注人数",
    ])
      expect(html).toContain(label);
    expect(html).toContain("待管理员定价渠道");
    expect(html).toContain("待定价渠道");
    expect(html).toContain("待定价");
    expect(html).toContain("30 个来源日");
    expect(html).toContain("1 个观察中批次");
    expect(html).not.toContain("$0.00");
  });
});
