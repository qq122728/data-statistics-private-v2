import { db } from "./db";
import { getApprovedInvalidFanTotals } from "./invalid-fan-reports";

export type SourcePerformanceSummaryRow = {
  channelType: "SMS" | "ADS" | "REBATE";
  sourceName: "短信粉" | "投流粉" | "底料返点";
  added: number;
  effective: number;
  depositCents: number;
  withdrawalCents: number;
  netPerformanceCents: number;
};

const sourceLabels: Record<SourcePerformanceSummaryRow["channelType"], SourcePerformanceSummaryRow["sourceName"]> = {
  SMS: "短信粉",
  ADS: "投流粉",
  REBATE: "底料返点",
};

function isEffective(lead: { invalid: boolean; receptionCategory: string }) {
  return !lead.invalid && !["INVALID", "LOW_AMOUNT", "NO_WS"].includes(lead.receptionCategory);
}

function activeOrder<T extends { openedOn: string; voidedAt: Date | null }>(order: T | null, today: string) {
  const voidedByToday = order?.voidedAt ? order.voidedAt.toISOString().slice(0, 10) <= today : false;
  return order && !voidedByToday && order.openedOn <= today ? order : null;
}

/**
 * 按批次保存的渠道快照计算来源业绩，避免日后改价影响已经导入的历史月份。
 */
export async function loadSourcePerformanceSummary(input: { groupIds: string[]; sourceDateFrom: string; sourceDateTo: string; today: string }) {
  const [leads, approvedInvalidReports] = await Promise.all([
    db.leadCustomer.findMany({
    where: { batch: { groupId: { in: input.groupIds }, sourceDate: { gte: input.sourceDateFrom, lte: input.sourceDateTo } } },
    select: {
      isHistoricalRecord: true,
      invalid: true,
      receptionCategory: true,
      batch: {
        select: {
          isHistoricalRecord: true,
          channelTypeSnapshot: true,
        },
      },
      customerOrder: {
        select: {
          openedOn: true,
          initialDepositCents: true,
          voidedAt: true,
          events: { select: { kind: true, amountCents: true, continuationNumber: true, occurredOn: true, voidedAt: true } },
        },
      },
    },
    }),
    getApprovedInvalidFanTotals({
      groupIds: input.groupIds,
      sourceDateFrom: input.sourceDateFrom,
      sourceDateTo: input.sourceDateTo,
    }),
  ]);

  const rows = new Map<SourcePerformanceSummaryRow["channelType"], SourcePerformanceSummaryRow>();
  for (const channelType of ["SMS", "ADS", "REBATE"] as const) {
    rows.set(channelType, { channelType, sourceName: sourceLabels[channelType], added: 0, effective: 0, depositCents: 0, withdrawalCents: 0, netPerformanceCents: 0 });
  }

  for (const lead of leads) {
    const row = rows.get(lead.batch.channelTypeSnapshot)!;
    const historical = lead.isHistoricalRecord || lead.batch.isHistoricalRecord;
    if (!historical) row.added += 1;
    const effective = !historical && isEffective(lead);
    if (effective) row.effective += 1;

    const order = activeOrder(lead.customerOrder, input.today);
    let depositCents = order?.initialDepositCents ?? 0;
    let withdrawalCents = 0;
    if (order) {
      for (const event of order.events) {
        if (event.occurredOn > input.today) continue;
        if (event.voidedAt && event.voidedAt.toISOString().slice(0, 10) <= input.today) continue;
        if (event.kind === "RECHARGE" && event.continuationNumber !== null) depositCents += event.amountCents ?? 0;
        if (event.kind === "WITHDRAWAL") withdrawalCents += event.amountCents ?? 0;
      }
    }
    row.depositCents += depositCents;
    row.withdrawalCents += withdrawalCents;
    row.netPerformanceCents += depositCents - withdrawalCents;
  }
  // 无效粉只记录人数，不生成客户和资金；来源汇总仍需把组长确认的数量算进“添加数据”。
  for (const report of approvedInvalidReports) {
    const row = rows.get(report.channelType);
    if (row) row.added += report.total;
  }
  return [...rows.values()];
}
