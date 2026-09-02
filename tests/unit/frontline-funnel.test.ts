import { describe, expect, it } from "vitest";
import { FUNNEL_CHIPS, type FunnelRow } from "../../apps/frontline/lib/funnel";

describe("frontline funnel display", () => {
  it("uses effective fans as the join-rate denominator", () => {
    const row: FunnelRow = {
      added: 100,
      duplicate: 0,
      lowAmount: 10,
      noWs: 10,
      effective: 80,
      replied: 40,
      joined: 10,
      left: 0,
      leftAbnormal: 0,
      pushed: 0,
      registered: 0,
      ordered: 0,
      depositUsd: 0,
      withdrawalUsd: 0,
      netUsd: 0,
    };

    expect(FUNNEL_CHIPS.find((chip) => chip.key === "joined")?.render(row)).toBe("10 · 12.5%");
  });
});
