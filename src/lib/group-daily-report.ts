import sharp from "sharp";
import type { LeadChannelReportPayload } from "./lead-channel-report-xlsx";

export type GroupDailyReportPersonnel = {
  frontDesk: string[];
  experts: string[];
  leads: string[];
  customerService: string[];
  operators: string[];
};

export type GroupDailyBusinessReport = {
  simulated: boolean;
  departmentName: string;
  groupName: string;
  countryName: string;
  reportDate: string;
  personnel: GroupDailyReportPersonnel;
  channelDispatch: Array<{ name: string; count: number }>;
  daily: LeadChannelReportPayload["summary"]["totals"];
  month: LeadChannelReportPayload["summary"]["totals"];
  yesterdayRemaining: number;
};

export function buildGroupDailyBusinessReport(input: {
  dailyPayload: LeadChannelReportPayload;
  monthPayload: LeadChannelReportPayload;
  yesterdayPayload: LeadChannelReportPayload;
  departmentName: string;
  countryName: string;
  personnel: GroupDailyReportPersonnel;
  simulated?: boolean;
}): GroupDailyBusinessReport {
  return {
    simulated: Boolean(input.simulated),
    departmentName: input.departmentName,
    groupName: input.dailyPayload.group.name,
    countryName: input.countryName,
    reportDate: input.dailyPayload.range.to,
    personnel: input.personnel,
    channelDispatch: input.dailyPayload.rows
      .filter((row) => row.totals.added > 0)
      .map((row) => ({ name: row.name, count: row.totals.added }))
      .sort((left, right) => right.count - left.count),
    daily: input.dailyPayload.summary.totals,
    month: input.monthPayload.summary.totals,
    yesterdayRemaining: input.yesterdayPayload.summary.totals.inGroup,
  };
}

const people = (names: string[]) => names.length ? names.join("、") : "—";
const integerMoney = (cents: number) => (cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const deposits = (totals: GroupDailyBusinessReport["daily"]) => totals.initialDepositCents + totals.rechargeCents;
const dateLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export function formatGroupDailyBusinessReport(report: GroupDailyBusinessReport): string {
  const dispatch = report.channelDispatch.length
    ? report.channelDispatch.map((row) => `${row.count}（${row.name}）`).join("，")
    : "0";
  return [
    report.simulated ? "【模拟小组测试｜不计入正式数据】" : "【小组业务日报】",
    `部门：${report.departmentName}（${report.groupName}）报表`,
    `日期：${dateLabel(report.reportDate)}`,
    "",
    `前台人员：${report.personnel.frontDesk.length}`,
    people(report.personnel.frontDesk),
    "",
    `专家：${people(report.personnel.experts)}  组长：${people(report.personnel.leads)}  客服：${people(report.personnel.customerService)}`,
    `炒群：${people(report.personnel.operators)}`,
    "",
    "————————————",
    report.countryName,
    "————————————",
    "",
    `当日资源部下发数据：${dispatch}`,
    `当日低金额数据：${report.daily.lowAmount}`,
    `当日无号码数据：${report.daily.noWs}`,
    `当日撞粉数据：${report.daily.collision}`,
    `当日有效数据：${report.daily.effective}`,
    `昨日在群余量：${report.yesterdayRemaining}`,
    "",
    `当月无号码数据：${report.month.noWs}`,
    `当月撞粉数据：${report.month.collision}`,
    "",
    "————————————",
    "",
    `当日添加数据：${report.daily.added}`,
    `当日回复数据：${report.daily.replied}`,
    `当日进群：${report.daily.joined}`,
    `当日首充：${integerMoney(report.daily.initialDepositCents)}`,
    `当日入金：${integerMoney(deposits(report.daily))}`,
    "当日通道：0",
    `当日出金：${integerMoney(report.daily.withdrawalCents)}`,
    `当日总业绩：${integerMoney(report.daily.netCents)}`,
    "",
    `当月添加数据：${report.month.added}`,
    `当月有效数据：${report.month.effective}`,
    `当月回复数据：${report.month.replied}`,
    `当月进群数据：${report.month.joined}`,
    `当月在群数据：${report.month.inGroup}`,
    `当月首充：${integerMoney(report.month.initialDepositCents)}`,
    `当月入金：${integerMoney(deposits(report.month))}`,
    "当月通道：0",
    `当月出金：${integerMoney(report.month.withdrawalCents)}`,
    `当月总业绩：${integerMoney(report.month.netCents)}`,
  ].join("\n");
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function svgText(x: number, y: number, text: string, options: { size?: number; weight?: number; color?: string } = {}) {
  return `<text x="${x}" y="${y}" font-size="${options.size ?? 28}" font-weight="${options.weight ?? 500}" fill="${options.color ?? "#26354d"}">${xml(text)}</text>`;
}

export async function buildGroupDailyReportPng(report: GroupDailyBusinessReport): Promise<Buffer> {
  const width = 1080;
  const height = 1420;
  const left = 70;
  const daily = report.daily;
  const month = report.month;
  const identityLines = [
    `前台 ${report.personnel.frontDesk.length} 人：${people(report.personnel.frontDesk)}`,
    `专家：${people(report.personnel.experts)}　组长：${people(report.personnel.leads)}`,
    `客服：${people(report.personnel.customerService)}　炒群：${people(report.personnel.operators)}`,
  ];
  const channelLines = report.channelDispatch.length
    ? report.channelDispatch.map((row) => `${row.name}  ${row.count}`)
    : ["暂无下发数据"];
  const metricRows = [
    ["添加数据", daily.added, month.added],
    ["有效数据", daily.effective, month.effective],
    ["回复数据", daily.replied, month.replied],
    ["进群数据", daily.joined, month.joined],
    ["当前在群", daily.inGroup, month.inGroup],
    ["首充", integerMoney(daily.initialDepositCents), integerMoney(month.initialDepositCents)],
    ["入金", integerMoney(deposits(daily)), integerMoney(deposits(month))],
    ["出金", integerMoney(daily.withdrawalCents), integerMoney(month.withdrawalCents)],
    ["总业绩", integerMoney(daily.netCents), integerMoney(month.netCents)],
  ];
  const cards = metricRows.map(([label, day, currentMonth], index) => {
    const y = 874 + index * 54;
    return `${index % 2 ? `<rect x="55" y="${y - 36}" width="970" height="54" fill="#f7f9fc"/>` : ""}${svgText(82, y, String(label), { size: 24, color: "#68758a" })}${svgText(610, y, String(day), { size: 25, weight: 700 })}${svgText(850, y, String(currentMonth), { size: 25, weight: 700 })}`;
  }).join("");
  const channelSvg = channelLines.slice(0, 4).map((line, index) => svgText(582, 574 + index * 42, line, { size: 23, weight: 650, color: "#315b93" })).join("");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1420" fill="#eef3f9"/>
    <rect x="32" y="32" width="1016" height="1356" rx="28" fill="#ffffff"/>
    <rect x="32" y="32" width="1016" height="185" rx="28" fill="#245da8"/>
    <rect x="32" y="180" width="1016" height="37" fill="#245da8"/>
    ${svgText(left, 95, report.simulated ? "模拟小组业务日报" : "小组业务日报", { size: 46, weight: 800, color: "#ffffff" })}
    ${svgText(left, 148, `${report.departmentName} · ${report.groupName}`, { size: 28, weight: 650, color: "#dceaff" })}
    ${svgText(930, 102, dateLabel(report.reportDate), { size: 30, weight: 750, color: "#ffffff" })}
    ${report.simulated ? svgText(left, 190, "测试数据，不计入正式报表", { size: 21, weight: 650, color: "#ffdd83" }) : ""}
    ${svgText(left, 270, report.countryName, { size: 32, weight: 800, color: "#1b3f70" })}
    ${identityLines.map((line, index) => svgText(left, 324 + index * 42, line, { size: 23 })).join("")}
    <rect x="55" y="470" width="470" height="270" rx="18" fill="#f5f8fd" stroke="#dce6f4"/>
    ${svgText(82, 520, "当日资源数据", { size: 28, weight: 800, color: "#1b3f70" })}
    ${svgText(82, 574, `有效 ${daily.effective}　低金额 ${daily.lowAmount}`, { size: 24 })}
    ${svgText(82, 620, `无号码 ${daily.noWs}　撞粉 ${daily.collision}`, { size: 24 })}
    ${svgText(82, 666, `昨日在群余量 ${report.yesterdayRemaining}`, { size: 24 })}
    <rect x="555" y="470" width="470" height="270" rx="18" fill="#f5f8fd" stroke="#dce6f4"/>
    ${svgText(582, 520, "渠道下发", { size: 28, weight: 800, color: "#1b3f70" })}
    ${channelSvg}
    <line x1="55" y1="782" x2="1025" y2="782" stroke="#dbe2ec"/>
    ${svgText(82, 820, "业务指标", { size: 24, weight: 750, color: "#68758a" })}
    ${svgText(610, 820, "当日", { size: 24, weight: 750, color: "#68758a" })}
    ${svgText(850, 820, "当月", { size: 24, weight: 750, color: "#68758a" })}
    ${cards}
    ${svgText(left, 1350, "数据来自系统同一统计口径 · Excel、文字和图片数字一致", { size: 20, color: "#8a94a6" })}
  </svg>`;
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
