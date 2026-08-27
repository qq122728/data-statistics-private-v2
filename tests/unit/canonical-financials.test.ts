import { describe, expect, it } from "vitest";
import { calculateCanonicalFinancials } from "../../src/lib/analytics/canonical-financials";
import type { CanonicalMetricEvent } from "../../src/lib/analytics/canonical-events";

function event(kind: CanonicalMetricEvent["kind"], amountCents: number): CanonicalMetricEvent {
  return {
    id: `${kind}-${amountCents}`,
    kind,
    quantity: null,
    amountCents,
    occurredOn: "2026-08-18",
    batchId: "rebate-batch",
    enteredById: "reception-a",
    voidedAt: null,
    batch: {
      sourceDate: "2026-08-18",
      group: { id: "group-a", name: "A组" },
      channel: {
        id: "rebate-a",
        groupId: "group-a",
        name: "底料渠道",
        normalizedName: "底料渠道",
        fanCostMode: "FREE",
        effectiveFanPriceCents: 0,
        channelType: "REBATE",
        rebateRateBps: 3000,
      },
    },
    enteredBy: {
      id: "reception-a",
      name: "接粉员A",
      role: "RECEPTION",
      active: true,
      hireDate: null,
      stageOverride: null,
    },
  };
}

describe("统一财务口径", () => {
  it("底料返点只把扣除返点后的净业绩计入公司利润", () => {
    const financials = calculateCanonicalFinancials([
      event("RECHARGE", 800_000),
      event("WITHDRAWAL", 0),
    ]);

    expect(financials).toEqual({
      costCents: 0,
      rebateCents: 240_000,
      profitCents: 560_000,
    });
  });
});
