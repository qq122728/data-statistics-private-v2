import { describe, expect, it } from "vitest";
import { buildLeadChannelReportWorkbook, type LeadChannelReportPayload } from "../../src/lib/lead-channel-report-xlsx";

const totals = {
  added: 10, collision: 1, lowAmount: 1, noWs: 1, manualInvalid: 0,
  lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0,
  effective: 7, replied: 5, joined: 4, left: 1, leftAbnormal: 1, inGroup: 3,
  pushed: 3, registered: 2, ordered: 1, initialDepositCents: 100_00, rechargeCents: 50_00,
  withdrawalCents: 20_00, netCents: 130_00, cryptoDepositCents: 150_00, bankDepositCents: 0,
};
const rates = {
  effectiveRate: 0.7, replyRate: 5 / 7, joinRate: 4 / 7, registrationRate: 2 / 3,
  orderRate: 0.5, abnormalLeaveRate: 0.25, lawyerReplyRate: 0.5,
  lawyerAddedRate: null, lawyerExpertAddedRate: null,
};

describe("group leader channel report workbook", () => {
  it("exports people, channels, daily rows and financial metrics in separate sheets", async () => {
    const member = { id: "member-1", name: "西瓜", totals, derivedRates: rates, channels: [] };
    const channel = { id: "channel-1", name: "FB-M", totals, derivedRates: rates, members: [{ ...member, channels: undefined }] };
    const payload: LeadChannelReportPayload = {
      group: { name: "WM西瓜组", groupType: "HACKER" },
      range: { from: "2026-08-01", to: "2026-08-31", label: "2026年8月" },
      summary: { name: "全组", totals, derivedRates: rates },
      members: [member], rows: [channel], days: [{ date: "2026-08-30", summary: { name: "当日", totals, derivedRates: rates }, rows: [channel] }],
    };
    const workbook = await buildLeadChannelReportWorkbook(payload);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "最新日报", "每日数据", "日数据汇总", "个人月度汇总", "团队月度汇总", "渠道统计", "每日渠道明细", "渠道成员明细",
    ]);
    expect(workbook.getWorksheet("渠道统计")?.getCell("A5").value).toBe("FB-M");
    expect(workbook.getWorksheet("渠道统计")?.getCell("Y5").value).toBe(130);
    expect(workbook.getWorksheet("每日渠道明细")?.getCell("A4").value).toBe("2026-08-30");
    expect(workbook.getWorksheet("每日数据")?.getCell("A5").value).toBe("2026-08-30");
    expect(workbook.getWorksheet("个人月度汇总")?.getCell("A5").value).toBe("西瓜");
    expect(workbook.getWorksheet("团队月度汇总")?.getCell("I5").value).toBe(130);
  });
});
