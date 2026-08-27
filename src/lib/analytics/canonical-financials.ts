import { calculateFinancials } from "../finance";
import { calculateBatchTotals } from "../metrics";
import type { CanonicalMetricEvent } from "./canonical-events";

export type CanonicalFinancials = {
  costCents: number | null;
  rebateCents: number | null;
  profitCents: number | null;
};

/**
 * 财务只按导入时冻结的渠道快照计算。底料返点按批次净入金扣除返点后，
 * 只把剩余金额计入公司和员工业绩。
 */
export function calculateCanonicalFinancials(events: CanonicalMetricEvent[]): CanonicalFinancials {
  const byBatch = new Map<string, CanonicalMetricEvent[]>();
  for (const event of events) {
    const rows = byBatch.get(event.batchId) ?? [];
    rows.push(event);
    byBatch.set(event.batchId, rows);
  }
  let costCents = 0;
  let rebateCents = 0;
  let profitCents = 0;
  for (const rows of byBatch.values()) {
    const totals = calculateBatchTotals(rows);
    const channel = rows[0]?.batch.channel;
    if (!channel) continue;
    const result = calculateFinancials({
      effectiveFans: totals.effectiveFans,
      rechargeCents: totals.rechargeCents,
      withdrawalCents: totals.withdrawalCents,
      channelPerformanceCents: totals.channelPerformanceCents,
      effectiveFanPriceCents: channel.fanCostMode === "FREE" ? 0 : channel.effectiveFanPriceCents,
      channelType: channel.channelType,
      rebateRateBps: channel.rebateRateBps,
    });
    if (result.costCents === null || result.profitCents === null) return { costCents: null, rebateCents: null, profitCents: null };
    costCents += result.costCents;
    rebateCents += result.rebateCents ?? 0;
    profitCents += result.profitCents;
  }
  return { costCents, rebateCents, profitCents };
}
