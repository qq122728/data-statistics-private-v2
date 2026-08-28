import { describe, expect, it } from "vitest";
import { metricValues, operatorRow } from "../../src/lib/member-performance-xlsx";
import type { GroupOperatorRankingRow } from "../../src/lib/analytics/role-rankings";

const baseOperator: GroupOperatorRankingRow = {
  id: "op", name: "组长 A", active: true, groupId: "g", groupName: "A组",
  pairedReceptionCount: 1, sharedCustomerCount: 10, currentInGroup: 40,
  introducedActions: 3, leaveActions: 2, abnormalLeaveActions: 2,
  downstreamRegistered: 1, downstreamContacted: 1, downstreamOrders: 1,
  firstDepositCents: 0, depositCents: 0, withdrawalCents: 0, netCents: 0,
  eligibleForIntroduction: 5, introducedEligible: 3,
};

describe("组员业绩 Excel 导出：炒群行", () => {
  it("进群列留空（不冒充接手客户或当前在群），异常退群率仍按接手客户数计算", () => {
    const row = operatorRow(baseOperator);
    const values = metricValues(row);
    // headers.slice(1) 的顺序：添加/撞粉/低金额/无WS/有效/回复/回复率/进群/进群率/退群/异常退群率/...
    expect(values[7]).toBeNull(); // 进群
    expect(values[10]).toBeCloseTo(0.2); // 异常退群率 = 2 / 10
  });

  it("当前在群(40)不会被当成任何列的分子分母混进比率里", () => {
    const row = operatorRow(baseOperator);
    expect(row.joined).toBeNull();
    expect(row.abnormalLeaveRateBase).toBe(10);
  });
});
