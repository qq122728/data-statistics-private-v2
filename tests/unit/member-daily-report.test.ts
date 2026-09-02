import { describe, expect, it } from "vitest";
import { buildMemberPerformanceWorkbook } from "../../src/lib/member-performance-xlsx";

describe("组长每日数据报表", () => {
  it("把单日导出标记为日报", async () => {
    const workbook = await buildMemberPerformanceWorkbook({
      from: "2026-08-19",
      to: "2026-08-19",
      reportType: "daily",
      summary: {
        reception: [{ id: "reception-1", name: "接粉 A", active: true, groupId: "group-1", groupName: "A组", total: 2, lowAmount: 0, noWs: 0, duplicate: 0, invalid: 0, valid: 2, replied: 1, joined: 1, left: 0, expertIntroduced: 0, expertContacted: 0, registered: 0, orders: 0, firstDepositCents: 10000, depositCents: 10000, withdrawalCents: 0, netCents: 9800 }],
        groupOperators: [], experts: [],
        groups: [{ id: "group-1", name: "A组", valid: 2, replied: 1, joined: 1, left: 0, expertIntroduced: 0, expertContacted: 0, registered: 0, orders: 0, firstDepositCents: 10000, depositCents: 10000, withdrawalCents: 0, netCents: 9800 }],
        standardsByGroup: {},
      },
      daily: [{
        date: "2026-08-19",
        result: {
          reception: [{ id: "reception-1", name: "接粉 A", active: true, groupId: "group-1", groupName: "A组", total: 2, lowAmount: 0, noWs: 0, duplicate: 0, invalid: 0, valid: 2, replied: 1, joined: 1, left: 0, expertIntroduced: 0, expertContacted: 0, registered: 0, orders: 0, firstDepositCents: 10000, depositCents: 10000, withdrawalCents: 0, netCents: 9800 }],
          groupOperators: [], experts: [],
          groups: [{ id: "group-1", name: "A组", valid: 2, replied: 1, joined: 1, left: 0, expertIntroduced: 0, expertContacted: 0, registered: 0, orders: 0, firstDepositCents: 10000, depositCents: 10000, withdrawalCents: 0, netCents: 9800 }],
          standardsByGroup: {},
        },
      }],
      duplicateByDayGroup: new Map([["2026-08-19:group-1", 0]]),
      sourceSummary: [
        { channelType: "SMS", sourceName: "短信粉", added: 2, effective: 2, depositCents: 0, withdrawalCents: 0, netPerformanceCents: -200 },
      ],
    });
    expect(workbook.getWorksheet("小组月度汇总")?.getCell("A1").value).toBe("小组每日数据报表（2026-08-19）");
    expect(workbook.getWorksheet("小组月度汇总")?.getCell("A2").value).toContain("当天导入的客户");
    expect(workbook.getWorksheet("小组月度汇总")?.getCell("D5").numFmt ?? "").not.toContain("$");
    expect(workbook.getWorksheet("小组月度汇总")?.getCell("O5").numFmt).not.toBe("0.0%");
    expect(workbook.getWorksheet("接粉-接粉 A")?.getCell("A1").value).toContain("当日明细");
    expect(workbook.getWorksheet("小组月度汇总")?.getCell("V15").value).toBe(100);
    expect(workbook.getWorksheet("接粉-接粉 A")?.getCell("D5").numFmt ?? "").not.toContain("$");
    expect(workbook.getWorksheet("接粉-接粉 A")?.getCell("A6").value).toBe("当日汇总");
  });
});
