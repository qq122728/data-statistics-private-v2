import { describe, expect, it, vi } from "vitest";
import { buildGroupDailyReportPng, formatGroupDailyBusinessReport, type GroupDailyBusinessReport } from "../../src/lib/group-daily-report";
import { sendTelegramDocument, sendTelegramPhoto } from "../../src/lib/telegram-delivery";

function report(): GroupDailyBusinessReport {
  const totals = {
    added: 100, collision: 2, lowAmount: 1, noWs: 3, manualInvalid: 0,
    lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0,
    effective: 94, replied: 37, joined: 6, left: 0, leftAbnormal: 0, inGroup: 6,
    pushed: 0, registered: 0, ordered: 1, initialDepositCents: 100000, rechargeCents: 47100,
    withdrawalCents: 0, netCents: 147100, cryptoDepositCents: 147100, bankDepositCents: 0,
  };
  return {
    simulated: true, departmentName: "恒升部", groupName: "西瓜组", countryName: "美国", reportDate: "2026-09-01",
    personnel: { frontDesk: ["桃子", "添越"], experts: ["西瓜"], leads: ["西瓜"], customerService: ["西瓜"], operators: ["阿水"] },
    channelDispatch: [{ name: "嘉豪短信", count: 100 }], daily: totals, month: totals, yesterdayRemaining: 4,
  };
}

describe("小组业务日报", () => {
  it("文字日报明确区分当日、当月和模拟数据", () => {
    const text = formatGroupDailyBusinessReport(report());
    expect(text).toContain("【模拟小组测试｜不计入正式数据】");
    expect(text).toContain("当日资源部下发数据：100（嘉豪短信）");
    expect(text).toContain("当日入金：1,471");
    expect(text).toContain("当月总业绩：1,471");
  });

  it("生成真实 PNG 文件", async () => {
    const png = await buildGroupDailyReportPng(report());
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.length).toBeGreaterThan(20_000);
  });

  it("Telegram 图片和 Excel 使用附件接口", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_BOSS_CHAT_ID", "test-chat");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await sendTelegramPhoto(Buffer.from("png"), "图片");
    await sendTelegramDocument(Buffer.from("xlsx"), "日报.xlsx", "Excel");
    expect(fetchMock.mock.calls[0][0]).toContain("/sendPhoto");
    expect(fetchMock.mock.calls[1][0]).toContain("/sendDocument");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
