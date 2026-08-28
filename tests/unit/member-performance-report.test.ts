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
});
