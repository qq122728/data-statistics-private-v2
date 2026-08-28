import { describe, expect, it } from "vitest";
import { memberPerformanceCsv, memberPerformanceReportRows } from "../../src/lib/member-performance-report";

describe("组员业绩导出", () => {
  it("按岗位输出统一的 Excel 列，并为接粉保留有效数据与归属净业绩", () => {
    const rows = memberPerformanceReportRows({
      reception: [{ id: "r", name: "接粉 A", active: true, groupId: "g", groupName: "A组", total: 10, lowAmount: 1, noWs: 1, invalid: 1, valid: 7, replied: 5, joined: 3, left: 1, expertIntroduced: 2, expertContacted: 2, registered: 1, orders: 1, firstDepositCents: 100000, depositCents: 123400, withdrawalCents: 3400, netCents: 113000 }],
      groupOperators: [], experts: [], groups: [], standardsByGroup: {},
    });
    expect(rows[0]).toMatchObject({ role: "前台接粉", effective: 7, replyRate: "71.4%", firstDeposit: "$1,000.00", netPerformance: "$1,130.00" });
    const csv = memberPerformanceCsv({ from: "2026-08-01", to: "2026-08-17", rows });
    expect(csv).toContain("撞粉,低金额,无 WS 号码,有效数据");
    expect(csv).not.toContain("人工无效");
    expect(csv).toContain("$1,130.00");
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("\u7092\u7FA4\u884C\u7684\u8FDB\u7FA4\u5217\u7559\u7A7A\uFF0C\u5F02\u5E38\u9000\u7FA4\u7387\u4ECD\u6309\u63A5\u624B\u5BA2\u6237\u6570\u8BA1\u7B97\uFF0C\u4E0D\u5192\u5145\u5F53\u524D\u5728\u7FA4\u6216\u8FDB\u7FA4", () => {
    const rows = memberPerformanceReportRows({
      reception: [], experts: [], groups: [], standardsByGroup: {},
      groupOperators: [{
        id: "op", name: "\u7EC4\u957F A", active: true, groupId: "g", groupName: "A\u7EC4",
        pairedReceptionCount: 1, sharedCustomerCount: 10, currentInGroup: 40,
        introducedActions: 3, leaveActions: 2, abnormalLeaveActions: 2,
        downstreamRegistered: 1, downstreamContacted: 1, downstreamOrders: 1,
        firstDepositCents: 0, depositCents: 0, withdrawalCents: 0, netCents: 0,
        eligibleForIntroduction: 5, introducedEligible: 3,
      }],
    });
    // \u5F53\u524D\u5728\u7FA4(40)\u662F\u4E0D\u53D7\u65E5\u671F\u8303\u56F4\u9650\u5236\u7684\u5168\u91CF\u5FEB\u7167\uFF0C\u8DDF"\u63A5\u624B\u5BA2\u6237"(10)\u4E0D\u662F\u540C\u4E00\u4E2A\u6570\u2014\u2014
    // \u8FDB\u7FA4\u5217\u5FC5\u987B\u7559\u7A7A\uFF0C\u4E0D\u80FD\u663E\u793A\u6210\u4EFB\u4F55\u4E00\u4E2A\u5BB9\u6613\u88AB\u8BEF\u8BFB\u6210"\u8FDB\u7FA4"\u7684\u6570\u5B57\u3002
    expect(rows[0]).toMatchObject({ joined: "\u2014", leaveRate: "20.0%" });
  });
});
