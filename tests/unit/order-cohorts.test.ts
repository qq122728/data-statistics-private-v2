import { describe, expect, it } from "vitest";
import { orderCohorts } from "../../src/lib/order-cohorts";

const row = (groupId: string, intakeOn: string, firstDepositOn: string, extra: Record<string, unknown> = {}) => ({
  groupId,
  data: JSON.stringify({ intakeOn, firstDepositOn, firstDeposit: 100, channelId: "channel-a", ...extra }),
});

describe("开单接粉批次", () => {
  it("按开单日期选范围，再按接粉日期区分本期和历史粉", () => {
    const result = orderCohorts([
      row("group-a", "2026-10-02", "2026-10-08"),
      row("group-a", "2026-09-20", "2026-10-08"),
      row("group-a", "2026-08-01", "2026-09-30"),
      row("group-a", "2026-10-01", "2026-10-08", { __deletedAt: "2026-10-09" }),
      row("group-b", "2026-09-01", "2026-10-08"),
      row("group-b", "2026-09-01", "2026-10-08", { __statisticsGroupId: "group-a" }),
    ], new Set(["group-a"]), "2026-10-01", "2026-10-10");
    expect(result).toEqual([{ groupId: "group-a", channelId: "channel-a", current: 1, previous: 2 }]);
  });

  it("没有真实首充金额或开单日期时不计入", () => {
    expect(orderCohorts([
      row("group-a", "2026-10-01", "2026-10-04", { firstDeposit: 0 }),
      row("group-a", "2026-10-01", "", { firstDeposit: 100 }),
    ], new Set(["group-a"]), "2026-10-01", "2026-10-10")).toEqual([]);
  });
});
