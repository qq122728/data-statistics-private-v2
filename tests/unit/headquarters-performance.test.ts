import { describe, expect, it } from "vitest";
import { buildHeadquartersPerformance } from "../../src/lib/analytics/headquarters-performance";
import type { ManagementOverview } from "../../src/lib/analytics/overview";

type GroupRow = NonNullable<ManagementOverview["groupComparison"]>[number];

const row = (values: Partial<GroupRow> & Pick<GroupRow, "groupId" | "groupName" | "departmentId" | "departmentName">): GroupRow => ({
  orders: 0,
  rechargeCents: 0,
  withdrawalCents: 0,
  netPerformanceCents: 0,
  costCents: 0,
  rebateCents: 0,
  profitCents: 0,
  effectiveFans: 0,
  matureNewFans: 0,
  matureOrders: 0,
  matureOrderRate: null,
  confirmedPeople: 0,
  activePeople: 0,
  risk: "LOW",
  ...values,
});

describe("headquarters performance leaderboard", () => {
  it("aggregates every group into its company and ranks by net performance", () => {
    const result = buildHeadquartersPerformance([
      row({ groupId: "a-1", groupName: "A一组", departmentId: "a", departmentName: "A公司", rechargeCents: 20_000, withdrawalCents: 5_000, netPerformanceCents: 15_000, costCents: 2_000, profitCents: 13_000, orders: 2, newFans: 20, effectiveFans: 18, replies: 10, groupJoin: 8, expertIntro: 6, expertContacted: 5, matureNewFans: 10, matureOrders: 1, matureOrderRate: 0.1 }),
      row({ groupId: "a-2", groupName: "A二组", departmentId: "a", departmentName: "A公司", rechargeCents: 10_000, withdrawalCents: 0, netPerformanceCents: 10_000, costCents: 1_000, profitCents: 9_000, orders: 1, newFans: 10, effectiveFans: 9, replies: 8, groupJoin: 7, expertIntro: 4, expertContacted: 3, matureNewFans: 10, matureOrders: 3, matureOrderRate: 0.3 }),
      row({ groupId: "b-1", groupName: "B一组", departmentId: "b", departmentName: "B公司", rechargeCents: 22_000, withdrawalCents: 0, netPerformanceCents: 22_000, costCents: 4_000, profitCents: 18_000, orders: 2, matureNewFans: 20, matureOrders: 2, matureOrderRate: 0.1 }),
    ]);

    expect(result.companies.map((company) => [company.rank, company.departmentName, company.netPerformanceCents])).toEqual([
      [1, "A公司", 25_000],
      [2, "B公司", 22_000],
    ]);
    expect(result.companies[0]).toMatchObject({ groupCount: 2, orders: 3, costCents: 3_000, profitCents: 22_000, matureOrderRate: 0.2, newFans: 30, effectiveFans: 27, replies: 18, groupJoin: 15, expertIntro: 10, expertContacted: 8 });
    expect(result.groups.map((group) => group.groupId)).toEqual(["b-1", "a-1", "a-2"]);
  });

  it("does not invent company profit when any paid group is still unpriced", () => {
    const result = buildHeadquartersPerformance([
      row({ groupId: "a-1", groupName: "A一组", departmentId: "a", departmentName: "A公司", rechargeCents: 10_000, netPerformanceCents: 10_000, costCents: null, profitCents: null }),
      row({ groupId: "a-2", groupName: "A二组", departmentId: "a", departmentName: "A公司", rechargeCents: 5_000, netPerformanceCents: 5_000, costCents: 1_000, profitCents: 4_000 }),
    ]);

    expect(result.companies[0]).toMatchObject({ netPerformanceCents: 15_000, costCents: null, profitCents: null });
  });
});
