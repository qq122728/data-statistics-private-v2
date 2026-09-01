import ExcelJS from "exceljs";

type Totals = {
  added: number; collision: number; lowAmount: number; noWs: number; manualInvalid: number;
  lawyerRealCase: number; lawyerAdded: number; lawyerExpertAdded: number; customerServicePush: number;
  effective: number; replied: number; joined: number; left: number; leftAbnormal: number; inGroup: number;
  pushed: number; registered: number; ordered: number; initialDepositCents: number; rechargeCents: number;
  withdrawalCents: number; netCents: number; cryptoDepositCents: number; bankDepositCents: number;
};

type Rates = {
  effectiveRate: number | null; replyRate: number | null; joinRate: number | null; registrationRate: number | null;
  orderRate: number | null; abnormalLeaveRate: number | null; lawyerReplyRate: number | null;
  lawyerAddedRate: number | null; lawyerExpertAddedRate: number | null;
};

type Slice = { id?: string; name: string; totals: Totals; derivedRates: Rates };
type Channel = Slice & { members: Array<Slice & { id: string }> };
type Member = Slice & { id: string; channels: Array<Slice & { id: string }> };
type Day = { date: string; summary: Slice; rows: Channel[] };

export type LeadChannelReportPayload = {
  group: { name: string; groupType: "HACKER" | "LAWYER" };
  range: { from: string; to: string; label: string };
  summary: Slice;
  rows: Channel[];
  members: Member[];
  days: Day[];
};

type MetricColumn = { label: string; value: (row: Slice) => number | null; format?: "percent" | "money" };
const money = (cents: number) => cents / 100;
const normalLeave = (row: Slice) => Math.max(0, row.totals.left - row.totals.leftAbnormal);

const hackerColumns: MetricColumn[] = [
  { label: "添加数据", value: (row) => row.totals.added },
  { label: "撞粉", value: (row) => row.totals.collision },
  { label: "低金额", value: (row) => row.totals.lowAmount },
  { label: "无 WS 号码", value: (row) => row.totals.noWs },
  { label: "人工无效", value: (row) => row.totals.manualInvalid },
  { label: "有效数据", value: (row) => row.totals.effective },
  { label: "有效率", value: (row) => row.derivedRates.effectiveRate, format: "percent" },
  { label: "回复", value: (row) => row.totals.replied },
  { label: "回复率", value: (row) => row.derivedRates.replyRate, format: "percent" },
  { label: "进群", value: (row) => row.totals.joined },
  { label: "进群率", value: (row) => row.derivedRates.joinRate, format: "percent" },
  { label: "正常退群", value: normalLeave },
  { label: "异常退群", value: (row) => row.totals.leftAbnormal },
  { label: "异常退群率", value: (row) => row.derivedRates.abnormalLeaveRate, format: "percent" },
  { label: "当前在群", value: (row) => row.totals.inGroup },
  { label: "推专家", value: (row) => row.totals.pushed },
  { label: "注册", value: (row) => row.totals.registered },
  { label: "注册率", value: (row) => row.derivedRates.registrationRate, format: "percent" },
  { label: "开单", value: (row) => row.totals.ordered },
  { label: "开单率", value: (row) => row.derivedRates.orderRate, format: "percent" },
  { label: "首充（美元）", value: (row) => money(row.totals.initialDepositCents), format: "money" },
  { label: "续充（美元）", value: (row) => money(row.totals.rechargeCents), format: "money" },
  { label: "出金（美元）", value: (row) => money(row.totals.withdrawalCents), format: "money" },
  { label: "净业绩（美元）", value: (row) => money(row.totals.netCents), format: "money" },
];

const lawyerColumns: MetricColumn[] = [
  { label: "接粉", value: (row) => row.totals.added },
  { label: "回复", value: (row) => row.totals.replied },
  { label: "未回复", value: (row) => Math.max(0, row.totals.added - row.totals.replied) },
  { label: "接粉小金额", value: (row) => row.totals.lowAmount },
  { label: "接粉真实案件", value: (row) => row.totals.lawyerRealCase },
  { label: "回复率", value: (row) => row.derivedRates.lawyerReplyRate, format: "percent" },
  { label: "添加律师", value: (row) => row.totals.lawyerAdded },
  { label: "添加专家", value: (row) => row.totals.lawyerExpertAdded },
  { label: "添加律师率", value: (row) => row.derivedRates.lawyerAddedRate, format: "percent" },
  { label: "添加专家率", value: (row) => row.derivedRates.lawyerExpertAddedRate, format: "percent" },
  { label: "总推客服数量", value: (row) => row.totals.customerServicePush },
  { label: "总注册数量", value: (row) => row.totals.registered },
  { label: "总开单数量", value: (row) => row.totals.ordered },
  { label: "加密货币充值（美元）", value: (row) => money(row.totals.cryptoDepositCents), format: "money" },
  { label: "银行卡充值（美元）", value: (row) => money(row.totals.bankDepositCents), format: "money" },
  { label: "出金（美元）", value: (row) => money(row.totals.withdrawalCents), format: "money" },
  { label: "净业绩（美元）", value: (row) => money(row.totals.netCents), format: "money" },
];

function styleTitle(sheet: ExcelJS.Worksheet, title: string, endColumn: number) {
  sheet.mergeCells(1, 1, 1, endColumn);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 15 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5B9E" } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 30;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FF172033" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA9D18E" } };
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  row.height = 30;
}

function addMetricTable(input: {
  sheet: ExcelJS.Worksheet; startRow: number; leadingHeaders: string[];
  rows: Array<{ leading: Array<string | number>; slice: Slice }>; total?: Slice; totalLabel?: string;
  columns: MetricColumn[];
}) {
  const { sheet, startRow, leadingHeaders, rows, total, totalLabel = "合计", columns } = input;
  sheet.getRow(startRow).values = [...leadingHeaders, ...columns.map((column) => column.label)];
  styleHeader(sheet.getRow(startRow));
  for (const row of rows) sheet.addRow([...row.leading, ...columns.map((column) => column.value(row.slice))]);
  if (total) {
    const totalRow = sheet.addRow([totalLabel, ...Array(Math.max(0, leadingHeaders.length - 1)).fill(""), ...columns.map((column) => column.value(total))]);
    totalRow.font = { bold: true, color: { argb: "FF1E3A5F" } };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
  }
  const endRow = sheet.lastRow?.number ?? startRow;
  columns.forEach((column, index) => {
    const columnNumber = leadingHeaders.length + index + 1;
    if (column.format === "percent") sheet.getColumn(columnNumber).numFmt = "0.0%";
    if (column.format === "money") sheet.getColumn(columnNumber).numFmt = '$#,##0.00;[Red]-$#,##0.00';
  });
  for (let row = startRow; row <= endRow; row += 1) {
    sheet.getRow(row).eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFD6DEE9" } },
        right: { style: "thin", color: { argb: "FFE5EAF1" } },
      };
    });
  }
  sheet.autoFilter = { from: { row: startRow, column: 1 }, to: { row: endRow, column: leadingHeaders.length + columns.length } };
  sheet.views = [{ state: "frozen", ySplit: startRow, xSplit: leadingHeaders.length }];
}

function setWidths(sheet: ExcelJS.Worksheet, leadingWidths: number[], columns: MetricColumn[]) {
  leadingWidths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  columns.forEach((column, index) => { sheet.getColumn(leadingWidths.length + index + 1).width = column.format === "money" ? 16 : column.format === "percent" ? 12 : 12; });
}

export async function buildLeadChannelReportWorkbook(payload: LeadChannelReportPayload) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "数据统计";
  workbook.created = new Date();
  workbook.modified = new Date();
  const columns = payload.group.groupType === "LAWYER" ? lawyerColumns : hackerColumns;
  const period = payload.range.from === payload.range.to ? payload.range.from : `${payload.range.from} 至 ${payload.range.to}`;

  const summary = workbook.addWorksheet("数据汇总");
  styleTitle(summary, `${payload.group.name}｜数据汇总｜${period}`, 1 + columns.length);
  summary.mergeCells(2, 1, 2, 1 + columns.length);
  summary.getCell(2, 1).value = "说明：个人数据永久归最初接粉成员；渠道、人员、每日和财务使用同一统计口径。";
  summary.getCell(2, 1).font = { italic: true, color: { argb: "FF64748B" } };
  addMetricTable({ sheet: summary, startRow: 4, leadingHeaders: ["归属成员"], rows: payload.members.map((row) => ({ leading: [row.name], slice: row })), total: payload.summary, columns });
  setWidths(summary, [18], columns);

  const channels = workbook.addWorksheet("渠道统计");
  styleTitle(channels, `${payload.group.name}｜渠道统计｜${period}`, 1 + columns.length);
  channels.mergeCells(2, 1, 2, 1 + columns.length);
  channels.getCell(2, 1).value = "每个渠道单独显示完整业务指标和首充、续充、出金、净业绩。";
  channels.getCell(2, 1).font = { italic: true, color: { argb: "FF64748B" } };
  addMetricTable({ sheet: channels, startRow: 4, leadingHeaders: ["来源渠道"], rows: payload.rows.map((row) => ({ leading: [row.name], slice: row })), total: payload.summary, columns });
  setWidths(channels, [20], columns);

  const daily = workbook.addWorksheet("每日渠道明细");
  styleTitle(daily, `${payload.group.name}｜每日渠道明细｜${period}`, 2 + columns.length);
  addMetricTable({
    sheet: daily, startRow: 3, leadingHeaders: ["统计日期", "来源渠道"],
    rows: payload.days.flatMap((day) => day.rows.map((row) => ({ leading: [day.date, row.name], slice: row }))),
    total: payload.summary, columns,
  });
  setWidths(daily, [14, 20], columns);

  const channelMembers = workbook.addWorksheet("渠道成员明细");
  styleTitle(channelMembers, `${payload.group.name}｜渠道成员明细｜${period}`, 2 + columns.length);
  addMetricTable({
    sheet: channelMembers, startRow: 3, leadingHeaders: ["来源渠道", "归属成员"],
    rows: payload.rows.flatMap((channel) => channel.members.map((member) => ({ leading: [channel.name, member.name], slice: member }))),
    total: payload.summary, columns,
  });
  setWidths(channelMembers, [20, 18], columns);

  return workbook;
}
