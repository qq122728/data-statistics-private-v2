import { buildGroupDailyBusinessReport, formatGroupDailyBusinessReport } from "../src/lib/group-daily-report";
import { buildLeadChannelReportWorkbook, type LeadChannelReportPayload } from "../src/lib/lead-channel-report-xlsx";
import { sendBossTelegramDocument, sendBossTelegramMessage } from "../src/lib/boss-report/telegram";

if (process.env.CONFIRM_TELEGRAM_SIMULATION !== "YES") {
  throw new Error("如需发送模拟日报，请设置 CONFIRM_TELEGRAM_SIMULATION=YES");
}

const people = ["桃子", "添越", "阿水", "大头", "锦麟", "阿咪", "阿宝"];
const emptyTotals = () => ({
  added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0,
  lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0,
  effective: 0, replied: 0, joined: 0, left: 0, leftAbnormal: 0, inGroup: 0,
  pushed: 0, registered: 0, ordered: 0, initialDepositCents: 0, rechargeCents: 0,
  withdrawalCents: 0, netCents: 0, cryptoDepositCents: 0, bankDepositCents: 0,
});
const rates = { effectiveRate: null, replyRate: null, joinRate: null, registrationRate: null, orderRate: null, abnormalLeaveRate: null, lawyerReplyRate: null, lawyerAddedRate: null, lawyerExpertAddedRate: null };
const totals = { ...emptyTotals(), added: 100, effective: 100, replied: 37, joined: 6, inGroup: 6, rechargeCents: 147100, netCents: 147100, cryptoDepositCents: 147100 };
const members = people.map((name, index) => {
  const added = index < 2 ? 15 : 14;
  const effective = added;
  const replied = index < 2 ? 6 : 5;
  const joined = index < 6 ? 1 : 0;
  const memberTotals = { ...emptyTotals(), added, effective, replied, joined, inGroup: joined, rechargeCents: index === 0 ? 147100 : 0, netCents: index === 0 ? 147100 : 0, cryptoDepositCents: index === 0 ? 147100 : 0 };
  return { id: `sim-${index}`, name, totals: memberTotals, derivedRates: { ...rates, effectiveRate: 1, replyRate: replied / effective, joinRate: joined / effective }, channels: [{ id: "sim-channel", name: "嘉豪短信", totals: memberTotals, derivedRates: { ...rates, effectiveRate: 1, replyRate: replied / effective, joinRate: joined / effective } }] };
});
const channel: LeadChannelReportPayload["rows"][number] = { id: "sim-channel", name: "嘉豪短信", totals, derivedRates: { ...rates, effectiveRate: 1, replyRate: .37, joinRate: .06 }, members: members.map(({ channels: _channels, ...member }) => member) };

function payload(from: string, to: string): LeadChannelReportPayload {
  const summary = { id: "sim-summary", name: "全组", totals, derivedRates: { ...rates, effectiveRate: 1, replyRate: .37, joinRate: .06 } };
  return {
    group: { name: "西瓜组（模拟）", groupType: "HACKER" },
    range: { from, to, label: from === to ? from : `${from} 至 ${to}` },
    summary,
    rows: [channel],
    members,
    days: [{ date: to, summary, rows: [channel] }],
  };
}

const dailyPayload = payload("2026-09-01", "2026-09-01");
const report = buildGroupDailyBusinessReport({
  dailyPayload,
  monthPayload: dailyPayload,
  yesterdayPayload: { ...payload("2026-08-31", "2026-08-31"), summary: { ...dailyPayload.summary, totals: { ...totals, inGroup: 4 } } },
  departmentName: "恒升部",
  countryName: "美国",
  personnel: { frontDesk: people, experts: ["西瓜"], leads: ["西瓜"], customerService: ["西瓜"], operators: ["阿水", "锦麟"] },
  simulated: true,
});
async function main() {
  const text = formatGroupDailyBusinessReport(report);
  const workbook = await buildLeadChannelReportWorkbook(dailyPayload, { dailyReport: report });
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  await sendBossTelegramMessage(text);
  await sendBossTelegramDocument(xlsx, "模拟-西瓜组-业务报表-2026-09.xlsx", "【模拟小组测试】Excel详细报表｜不计入正式数据");
  console.log("模拟日报已发送：文字、Excel；未写入数据库。", { xlsxBytes: xlsx.length });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "模拟日报发送失败");
  process.exitCode = 1;
});
