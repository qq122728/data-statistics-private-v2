import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import { queryPerformanceLeaderboard } from "../../src/lib/analytics/performance-leaderboard-query";
import { buildDailyBossBrief } from "../../src/lib/boss-report/brief";
import { formatBossDailyBrief } from "../../src/lib/boss-report/format";

const querySource = readFileSync("src/lib/analytics/performance-leaderboard-query.ts", "utf8");
const pageSource = readFileSync("src/app/(app)/performance-leaderboard/page.tsx", "utf8");

describe("performance leaderboard aggregate query", () => {
  it("uses a dedicated database aggregate instead of the full management overview", () => {
    expect(pageSource).toContain("loadPerformanceLeaderboard");
    expect(pageSource).not.toContain("loadManagementOverview");
    expect(querySource).toContain("db.$queryRaw");
    expect(querySource).toContain('GROUP BY batch."groupId"');
  });

  it("does not select customer identity or follow-up alert details", () => {
    expect(querySource).not.toContain('lc."phone"');
    expect(querySource).not.toContain('lc."customerName"');
    expect(querySource).not.toContain('lc."nextPlan"');
    expect(querySource).not.toContain("registrationOverdue");
    expect(pageSource).toContain("performanceRows={leaderboardRows}");
  });

  it("uses a short cache and a single finance rollup for recharge and withdrawal totals", () => {
    expect(querySource).toContain("unstable_cache");
    expect(querySource).toContain("revalidate: 45");
    expect(querySource).toContain("finance_rollup");
  });

  it("executes the real SQLite query and merges ledger and legacy money by group", async () => {
    const groupId = "query-rebate-group";
    const channelId = "query-rebate-channel";
    const memberId = "query-rebate-member";
    const batchId = "query-rebate-batch";
    await db.teamGroup.create({ data: { id: groupId, name: "底料查询组" } });
    await db.user.create({ data: { id: memberId, username: memberId, name: "底料接粉员", passwordHash: "test", role: "RECEPTION", groupId } });
    await db.channel.create({ data: { id: channelId, groupId, name: "真实底料", normalizedName: "真实底料", channelType: "REBATE" } });
    await db.sourceBatch.create({ data: { id: batchId, groupId, channelId, sourceDate: "2026-08-10", channelTypeSnapshot: "REBATE" } });

    for (const suffix of ["a", "b"]) {
      const leadId = `query-rebate-lead-${suffix}`;
      const orderId = `query-rebate-order-${suffix}`;
      await db.leadCustomer.create({ data: { id: leadId, phone: `query-rebate-phone-${suffix}`, batchId, ownerId: memberId } });
      await db.customerOrder.create({ data: { id: orderId, phone: `query-rebate-phone-${suffix}`, batchId, enteredById: memberId, openedOn: "2026-08-10", initialDepositCents: 1, leadId } });
      // 兼容事件与订单账本表达的是同一笔首充，必须被排除，不能再加一次。
      await db.metricEvent.create({ data: { batchId, enteredById: memberId, occurredOn: "2026-08-10", kind: "RECHARGE", amountCents: 1, customerOrderId: orderId, derivedFromLedger: true } });
    }
    // 真正的旧版汇总资金可与号码账本共存。
    await db.metricEvent.create({ data: { batchId, enteredById: memberId, occurredOn: "2026-08-10", kind: "RECHARGE", amountCents: 7_998, derivedFromLedger: false } });

    const rows = await queryPerformanceLeaderboard({ groupIds: [groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-31", today: "2026-08-31" });
    expect(rows[0]).toMatchObject({
      rechargeCents: 8_000,
      withdrawalCents: 0,
      netPerformanceCents: 8_000,
    });
    const hiddenRows = await queryPerformanceLeaderboard({
      groupIds: [groupId],
      channelIds: ["not-assigned-to-resource-manager"],
      sourceDateFrom: "2026-08-01",
      sourceDateTo: "2026-08-31",
      today: "2026-08-31",
    });
    expect(hiddenRows[0]).toMatchObject({ newFans: 0, orders: 0, rechargeCents: 0 });

    // 页面排行榜直接展示这份查询结果；日报用今天与昨天的快照差值。
    // 这批数据全部发生在同一天，因此两边每一项金额和数量都必须完全相同。
    const yesterdayRows = await queryPerformanceLeaderboard({ groupIds: [groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-31", today: "2026-08-09" });
    const brief = buildDailyBossBrief({
      reportDate: "2026-08-10",
      currentRows: rows,
      previousRows: yesterdayRows,
      anomalies: { overdueExpertIntro: 0, overdueExpertContact: 0, overdueOrder: 0, invalidCustomers: 0 },
    });
    expect(brief.totals).toMatchObject({
      newFans: rows[0].newFans,
      effectiveFans: rows[0].effectiveFans,
      replies: rows[0].replies,
      groupJoin: rows[0].groupJoin,
      expertIntro: rows[0].expertIntro,
      expertContacted: rows[0].expertContacted,
      registration: rows[0].registration,
      orders: rows[0].orders,
      rechargeCents: rows[0].rechargeCents,
      withdrawalCents: rows[0].withdrawalCents,
      netPerformanceCents: rows[0].netPerformanceCents,
    });
    const dailyMessage = formatBossDailyBrief(brief, null);
    expect(dailyMessage).toContain("入金 $80.00｜出金 $0.00｜净业绩 $80.00");
  });

  it("excludes a voided order and every ledger amount attached to it", async () => {
    const groupId = "query-voided-group";
    const channelId = "query-voided-channel";
    const memberId = "query-voided-member";
    const batchId = "query-voided-batch";
    const leadId = "query-voided-lead";
    const orderId = "query-voided-order";
    const voidedAt = new Date("2026-08-12T08:00:00.000Z");
    await db.teamGroup.create({ data: { id: groupId, name: "作废查询组" } });
    await db.user.create({ data: { id: memberId, username: memberId, name: "作废接粉员", passwordHash: "test", role: "RECEPTION", groupId } });
    await db.channel.create({ data: { id: channelId, groupId, name: "作废渠道", normalizedName: "作废渠道", fanCostMode: "FREE", effectiveFanPriceCents: 0 } });
    await db.sourceBatch.create({ data: { id: batchId, groupId, channelId, sourceDate: "2026-08-10", fanCostModeSnapshot: "FREE", effectiveFanPriceCentsSnapshot: 0 } });
    await db.leadCustomer.create({ data: { id: leadId, phone: "query-voided-phone", batchId, ownerId: memberId } });
    await db.customerOrder.create({ data: { id: orderId, phone: "query-voided-phone", batchId, leadId, enteredById: memberId, openedOn: "2026-08-10", initialDepositCents: 80_000, voidedAt } });
    await db.metricEvent.createMany({ data: [
      { batchId, enteredById: memberId, occurredOn: "2026-08-10", kind: "ORDER", quantity: 1, customerOrderId: orderId, derivedFromLedger: true, voidedAt },
      { batchId, enteredById: memberId, occurredOn: "2026-08-10", kind: "RECHARGE", amountCents: 80_000, customerOrderId: orderId, derivedFromLedger: true, voidedAt },
      { batchId, enteredById: memberId, occurredOn: "2026-08-11", kind: "WITHDRAWAL", amountCents: 10_000, customerOrderId: orderId, derivedFromLedger: true, voidedAt },
    ] });

    const rows = await queryPerformanceLeaderboard({ groupIds: [groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-31", today: "2026-08-31" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orders: 0, rechargeCents: 0, withdrawalCents: 0, netPerformanceCents: 0 });
  });

  it("keeps historical totals after a member changes role and counts approved low-amount rows once", async () => {
    const groupId = "query-historical-transfer-group";
    const channelId = "query-historical-transfer-channel";
    const memberId = "query-historical-transfer-member";
    const leadId = "query-historical-transfer-lead";
    const batchId = "query-historical-transfer-batch";
    await db.teamGroup.create({ data: { id: groupId, name: "历史转岗组" } });
    await db.user.create({ data: { id: memberId, username: memberId, name: "已转炒群员工", passwordHash: "test", role: "GROUP_OPERATOR", groupId } });
    await db.channel.create({ data: { id: channelId, groupId, name: "历史渠道", normalizedName: "历史渠道", fanCostMode: "FREE", effectiveFanPriceCents: 0 } });
    await db.sourceBatch.create({ data: { id: batchId, groupId, channelId, sourceDate: "2026-08-20", isHistoricalRecord: true, fanCostModeSnapshot: "FREE", effectiveFanPriceCentsSnapshot: 0 } });
    await db.metricEvent.createMany({ data: [
      { batchId, enteredById: memberId, occurredOn: "2026-08-20", kind: "NEW_FANS", quantity: 7 },
      { batchId, enteredById: memberId, occurredOn: "2026-08-20", kind: "EFFECTIVE_FANS", quantity: 7 },
      { batchId, enteredById: memberId, occurredOn: "2026-08-20", kind: "RECHARGE", amountCents: 12_300 },
    ] });
    const report = await db.invalidFanReport.create({
      data: {
        id: leadId,
        batchId,
        reporterId: memberId,
        status: "APPROVED",
        noWsCount: 0,
        lowAmountCount: 3,
        collisionCount: 0,
        approvedNoWsCount: 0,
        approvedLowAmountCount: 3,
        approvedCollisionCount: 0,
      },
    });

    const rows = await queryPerformanceLeaderboard({ groupIds: [groupId], sourceDateFrom: "2026-08-01", sourceDateTo: "2026-08-31", today: "2026-08-31" });
    expect(rows[0]).toMatchObject({ newFans: 10, effectiveFans: 7, rechargeCents: 12_300, matureNewFans: 10 });

    await db.invalidFanReport.delete({ where: { id: report.id } });
  });
});
