import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntryOverview } from "../../src/components/entry/EntryOverview";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const TODAY = "2026-08-27";

/**
 * 登记开单时（src/app/api/customer-orders/route.ts）除了写 CustomerOrder，
 * 还会额外写一条 RECHARGE 镜像流水：金额等于首充、continuationNumber 为 null。
 * 统计续充时必须排除这条镜像，否则首充会被计入两次。
 */
function leadWithOrder(events: Array<{ amountCents: number; continuationNumber: number | null }>) {
  return {
    id: "lead-a", phone: "19980000007", isHistoricalRecord: false, historicalSourceName: null,
    invalid: false, invalidReason: null, receptionCategory: "VALID", replyStatus: "REPLIED",
    repliedOn: TODAY, followUpCount: 0, lastFollowedUpOn: null,
    customerName: "测试客户", customerEmail: null, lossAmountCents: null, customerPlatform: null,
    groupStatus: "JOINED", joinedOn: TODAY, leftOn: null,
    expertIntroducedOn: null, expertContactedOn: null, expertContactNote: null,
    expertWorkflowStage: null, expertStageChangedAt: null, expertTrackingStartedAt: null,
    registeredOn: null, expertNotes: null, nextPlan: null, nextFollowUpOn: null, notes: null,
    receptionChatStatus: "NORMAL_CHAT", receptionStatusChangedAt: null,
    receptionArchivedAt: null, receptionArchiveReason: null, receptionArchiveVisitCount: null,
    groupOperatorOwner: null, expertOwner: null, attributionOwner: null,
    owner: { name: "演示接粉", receptionistAssignments: [] }, activities: [], device: null,
    batch: {
      id: "batch-a", sourceDate: TODAY, fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: 3500,
      group: { name: "演示组" }, channel: { id: "channel-a", name: "演示渠道" },
    },
    customerOrder: {
      id: "order-a", openedOn: TODAY, initialDepositCents: 50_000, voidedAt: null,
      events: events.map((event, index) => ({
        id: `event-${index}`, kind: "RECHARGE", amountCents: event.amountCents,
        occurredOn: TODAY, continuationNumber: event.continuationNumber, voidedAt: null, voidReason: null,
      })),
    },
  };
}

describe("首充不能被重复计算", () => {
  it("排除登记开单写入的 RECHARGE 镜像行（continuationNumber 为空）", () => {
    // 只有一笔 $500 首充，没有任何真实续充；镜像行金额与首充相同。
    const markup = renderToStaticMarkup(createElement(EntryOverview, {
      leads: [leadWithOrder([{ amountCents: 50_000, continuationNumber: null }])] as never,
      invalidReports: [],
      today: TODAY,
    }));

    // 当日入金与净业绩都应为 $500.00，而不是把首充算两遍得到的 $1,000.00。
    expect(markup).toContain("$500.00");
    expect(markup).not.toContain("$1,000.00");
  });

  it("真实续充（带序号）仍然计入", () => {
    // $500 首充 + 镜像行 + 一笔真实的 $200 续充 ⇒ 入金应为 $700.00。
    const markup = renderToStaticMarkup(createElement(EntryOverview, {
      leads: [leadWithOrder([
        { amountCents: 50_000, continuationNumber: null },
        { amountCents: 20_000, continuationNumber: 1 },
      ])] as never,
      invalidReports: [],
      today: TODAY,
    }));

    expect(markup).toContain("$700.00");
    expect(markup).not.toContain("$1,200.00");
  });
});
