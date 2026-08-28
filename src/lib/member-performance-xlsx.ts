import ExcelJS from "exceljs";
import type {
  ExpertRankingRow,
  GroupOperatorRankingRow,
  ReceptionRankingRow,
  RoleRankingsResult,
} from "./analytics/role-rankings";
import type { SourcePerformanceSummaryRow } from "./source-performance-summary";

type Value = number | null;

type MemberMetricRow = {
  key: string;
  id: string;
  group: string;
  name: string;
  role: string;
  added: Value;
  lowAmount: Value;
  noWs: Value;
  duplicate: Value;
  effective: Value;
  replied: Value;
  joined: Value;
  // “进群”这一栏是接粉专属概念；炒群没有对应的原始计数可以展示（接手客户数是另一个概念，
  // 这张共享表里没有它的位置），但异常退群率仍需要接手客户数当分母，所以单独留一个字段给它，
  // 不能借用 joined——那样会把接手客户数误标成“进群”显示出来。
  abnormalLeaveRateBase?: Value;
  left: Value;
  abnormalLeft: Value;
  introduced: Value;
  contacted: Value;
  registered: Value;
  orders: Value;
  firstDepositCents: Value;
  depositCents: Value;
  withdrawalCents: Value;
  netPerformanceCents: Value;
};

export type WorkbookInput = {
  from: string;
  to: string;
  reportType?: "daily" | "monthly";
  summary: RoleRankingsResult;
  daily: Array<{ date: string; result: RoleRankingsResult }>;
  duplicateByDayGroup: Map<string, number>;
  sourceSummary: SourcePerformanceSummaryRow[];
};

const rate = (numerator: number | null, denominator: number | null) => numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null;
const money = (value: number | null) => value === null ? null : value / 100;

function receptionRow(row: ReceptionRankingRow, role = "前台接粉", keyPrefix = "reception"): MemberMetricRow {
  return {
    key: `${keyPrefix}:${row.id}`, id: row.id, group: row.groupName, name: row.name, role,
    added: row.total ?? row.valid, lowAmount: row.lowAmount ?? 0, noWs: row.noWs ?? 0, duplicate: row.duplicate ?? 0,
    effective: row.valid, replied: row.replied, joined: row.joined, left: row.left ?? 0, abnormalLeft: row.abnormalLeft ?? 0,
    introduced: row.expertIntroduced, contacted: row.expertContacted ?? 0, registered: row.registered, orders: row.orders,
    firstDepositCents: row.firstDepositCents, depositCents: row.depositCents, withdrawalCents: row.withdrawalCents, netPerformanceCents: row.netCents,
  };
}

export function operatorRow(row: GroupOperatorRankingRow): MemberMetricRow {
  return {
    key: `operator:${row.id}`, id: row.id, group: row.groupName, name: row.name, role: "前台炒群",
    added: null, lowAmount: null, noWs: null, duplicate: null, effective: null, replied: null,
    // 炒群没有“进群”这个原始概念可填（接手客户数是另一个概念，这张共享表放不下），留空；
    // 异常退群率的分母改回 role-rankings.ts 里 sharedCustomerCount 的既有算法，走专门的
    // abnormalLeaveRateBase 字段。注意 sharedCustomerCount 按客户归属统计，abnormalLeft
    // 按谁点了退群操作统计，同事代班处理时两者可能不是完全同一批人——这是 role-rankings.ts
    // 里这两个字段本身的既有口径差异，不是这次改动引入的，暂不在本轮修复范围内。
    joined: null, abnormalLeaveRateBase: row.sharedCustomerCount, left: row.leaveActions, abnormalLeft: row.abnormalLeaveActions ?? 0, introduced: row.introducedActions, contacted: row.downstreamContacted ?? 0,
    registered: row.downstreamRegistered, orders: row.downstreamOrders,
    firstDepositCents: row.firstDepositCents, depositCents: row.depositCents, withdrawalCents: row.withdrawalCents, netPerformanceCents: row.netCents,
  };
}

function expertRow(row: ExpertRankingRow): MemberMetricRow {
  return {
    key: `expert:${row.id}`, id: row.id, group: row.groupName, name: row.name, role: row.role === "LEAD" ? "组长（兼专家）" : "前台专家",
    added: null, lowAmount: null, noWs: null, duplicate: null, effective: null, replied: null, joined: null, left: null, abnormalLeft: null,
    introduced: row.assigned, contacted: row.contacted ?? 0, registered: row.registered, orders: row.orders,
    firstDepositCents: row.firstDepositCents, depositCents: row.depositCents, withdrawalCents: row.withdrawalCents, netPerformanceCents: row.netCents,
  };
}

function rowsFrom(result: RoleRankingsResult) {
  // 财务成员行按“粉的归属”计算；旧导出参数没有该字段时才回退旧的接粉维度。
  const fanOwnerRows = result.fanOwners?.length
    ? result.fanOwners.map((row) => receptionRow(row, "粉的归属", "fan-owner"))
    : result.reception.map((row) => receptionRow(row));
  return [...fanOwnerRows, ...result.groupOperators.map(operatorRow), ...result.experts.map(expertRow)];
}

const headers = [
  "日期", "添加数据", "撞粉", "低金额", "无 WS 号码", "有效数据", "回复", "回复率", "进群", "进群率", "退群", "异常退群率",
  "推专家", "专家已联系", "注册", "注册率", "开单", "开单率", "首充（美元）", "入金（美元）", "出金（美元）", "总业绩（美元）",
];

export function metricValues(row: MemberMetricRow) {
  return [
    row.added, row.duplicate, row.lowAmount, row.noWs, row.effective, row.replied, rate(row.replied, row.effective),
    row.joined, rate(row.joined, row.replied), row.left, rate(row.abnormalLeft, row.abnormalLeaveRateBase ?? row.joined), row.introduced, row.contacted,
    row.registered, rate(row.registered, row.contacted ?? row.introduced), row.orders, rate(row.orders, row.registered),
    money(row.firstDepositCents), money(row.depositCents), money(row.withdrawalCents), money(row.netPerformanceCents),
  ];
}

function styleTitle(cell: ExcelJS.Cell) {
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  row.height = 30;
}

function formatTable(sheet: ExcelJS.Worksheet, headerRow: number, percentageColumns: number[], moneyColumns: number[]) {
  styleHeader(sheet.getRow(headerRow));
  sheet.getRow(headerRow).eachCell((cell) => { cell.border = { bottom: { style: "thin", color: { argb: "FFD9E2F3" } } }; });
  // 同一张总表会分段放小组、渠道和成员数据。不能给整列套数字格式，
  // 否则渠道区的美元格式会反过来污染上方的数量列，导致 54 被显示成 $54.00。
  for (let rowNumber = headerRow + 1; rowNumber <= (sheet.lastRow?.number ?? headerRow); rowNumber += 1) {
    for (const column of percentageColumns) sheet.getCell(rowNumber, column).numFmt = "0.0%";
    for (const column of moneyColumns) sheet.getCell(rowNumber, column).numFmt = '$#,##0.00;[Red]-$#,##0.00';
  }
  sheet.views = [{ state: "frozen", ySplit: headerRow }];
}

function safeSheetName(prefix: string, name: string, used: Set<string>) {
  const root = `${prefix}-${name}`.replace(/[\\/*?:\[\]]/g, "").slice(0, 28) || prefix;
  let candidate = root;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${root.slice(0, 28)}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function sum(rows: MemberMetricRow[], accessor: (row: MemberMetricRow) => number | null) {
  return rows.reduce((total, row) => total + (accessor(row) ?? 0), 0);
}

function groupSummaryRows(input: WorkbookInput) {
  const receptionByGroup = new Map<string, ReceptionRankingRow[]>();
  for (const row of input.summary.reception) {
    const rows = receptionByGroup.get(row.groupId) ?? [];
    rows.push(row);
    receptionByGroup.set(row.groupId, rows);
  }
  return input.summary.groups.map((group) => {
    const reception = receptionByGroup.get(group.id) ?? [];
    return {
      name: group.name,
      added: sum(reception.map((row) => receptionRow(row)), (row) => row.added),
      lowAmount: sum(reception.map((row) => receptionRow(row)), (row) => row.lowAmount),
      noWs: sum(reception.map((row) => receptionRow(row)), (row) => row.noWs),
      duplicate: sum(reception.map((row) => receptionRow(row)), (row) => row.duplicate),
      effective: group.valid,
      replied: group.replied,
      joined: group.joined,
      left: group.left ?? 0,
      abnormalLeft: group.abnormalLeft ?? 0,
      introduced: group.expertIntroduced,
      contacted: group.expertContacted ?? 0,
      registered: group.registered,
      orders: group.orders,
      firstDepositCents: group.firstDepositCents,
      depositCents: group.depositCents,
      withdrawalCents: group.withdrawalCents,
      netPerformanceCents: group.netCents,
    };
  });
}

export async function buildMemberPerformanceWorkbook(input: WorkbookInput) {
  const dailyReport = input.reportType === "daily" || input.from === input.to;
  const reportTitle = dailyReport ? "小组每日数据报表" : "小组月度业绩统计";
  const memberSummaryTitle = dailyReport ? "成员当日汇总（每人一张当日明细子表）" : "成员月度汇总（每人一张每日明细子表）";
  const totalLabel = dailyReport ? "当日汇总" : "当月汇总";
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "数据统计";
  workbook.created = new Date();
  workbook.modified = new Date();
  const overview = workbook.addWorksheet("小组月度汇总");
  overview.mergeCells("A1:V1");
  overview.getCell("A1").value = dailyReport ? `${reportTitle}（${input.from}）` : `${reportTitle}（${input.from} 至 ${input.to}）`;
  styleTitle(overview.getCell("A1"));
  overview.getRow(1).height = 26;
  overview.mergeCells("A2:V2");
  overview.getCell("A2").value = dailyReport
    ? "说明：本报表统计选择日期当天导入的客户，流程和资金只计算截至当天已经发生的记录；“粉的归属”行按客户归属计算业绩，其余岗位行按实际工作环节统计。"
    : "说明：汇总按号码所属小组统计；“粉的归属”行按客户归属计算业绩，其余岗位行按实际工作环节统计。撞粉为系统发现或人工确认的重复号码，不创建客户。";
  overview.getCell("A2").font = { color: { argb: "FF64748B" }, italic: true };
  overview.getRow(4).values = ["小组", ...headers.slice(1)];
  const groupRows = groupSummaryRows(input);
  for (const row of groupRows) {
    overview.addRow([row.name, ...metricValues({ key: row.name, id: row.name, group: row.name, role: "小组", ...row })]);
  }
  formatTable(overview, 4, [8, 10, 12, 16, 18], [19, 20, 21, 22]);
  overview.columns = [{ width: 16 }, ...headers.slice(1).map((label) => ({ width: label.includes("率") ? 11 : label.includes("美元") || label.includes("业绩") ? 15 : 12 }))];

  const sourceSummaryTitleRow = overview.lastRow!.number + 3;
  overview.mergeCells(sourceSummaryTitleRow, 1, sourceSummaryTitleRow, 7);
  overview.getCell(sourceSummaryTitleRow, 1).value = "来源业绩汇总（按渠道类型）";
  overview.getCell(sourceSummaryTitleRow, 1).font = { bold: true, color: { argb: "FF1F2937" } };
  overview.getRow(sourceSummaryTitleRow + 1).values = ["来源", "添加数据", "有效数据", "入金（美元）", "出金（美元）", "净业绩（美元）"];
  for (const row of input.sourceSummary) {
    overview.addRow([
      row.sourceName,
      row.added,
      row.effective,
      money(row.depositCents),
      money(row.withdrawalCents),
      money(row.netPerformanceCents),
    ]);
  }
  formatTable(overview, sourceSummaryTitleRow + 1, [], [4, 5, 6]);

  const summaryMembers = rowsFrom(input.summary);
  const memberSummaryHeader = overview.lastRow!.number + 3;
  overview.mergeCells(memberSummaryHeader, 1, memberSummaryHeader, 24);
  overview.getCell(memberSummaryHeader, 1).value = memberSummaryTitle;
  overview.getCell(memberSummaryHeader, 1).font = { bold: true, color: { argb: "FF1F2937" } };
  overview.getRow(memberSummaryHeader + 1).values = ["小组", "姓名", "岗位", ...headers.slice(1)];
  for (const row of summaryMembers) overview.addRow([row.group, row.name, row.role, ...metricValues(row)]);
  formatTable(overview, memberSummaryHeader + 1, [10, 12, 14, 18, 20], [21, 22, 23, 24]);

  const dailyByMember = new Map<string, Map<string, MemberMetricRow>>();
  for (const { date, result } of input.daily) {
    for (const row of rowsFrom(result)) {
      const values = dailyByMember.get(row.key) ?? new Map<string, MemberMetricRow>();
      values.set(date, row);
      dailyByMember.set(row.key, values);
    }
  }
  const usedNames = new Set<string>(["小组月度汇总"]);
  for (const member of summaryMembers) {
    const prefix = member.role === "粉的归属" ? "归属" : member.role === "前台接粉" ? "接粉" : member.role === "前台炒群" ? "炒群" : "专家";
    const sheet = workbook.addWorksheet(safeSheetName(prefix, member.name, usedNames));
    sheet.mergeCells("A1:V1");
    sheet.getCell("A1").value = `${member.group}｜${member.name}｜${member.role}｜${dailyReport ? "当日明细" : "每日明细"}`;
    styleTitle(sheet.getCell("A1"));
    sheet.getRow(1).height = 26;
    sheet.mergeCells("A2:V2");
    sheet.getCell("A2").value = dailyReport ? `${input.from}。空白表示该岗位不负责这一项，不代表 0。` : `${input.from} 至 ${input.to}。空白表示该岗位不负责这一项，不代表 0。`;
    sheet.getCell("A2").font = { color: { argb: "FF64748B" }, italic: true };
    sheet.getRow(4).values = headers;
    const dailyValues = dailyByMember.get(member.key) ?? new Map<string, MemberMetricRow>();
    for (const day of input.daily) {
      const row = dailyValues.get(day.date);
      sheet.addRow([day.date, ...(row ? metricValues(row) : Array(headers.length - 1).fill(null))]);
    }
    const totalRow = sheet.addRow([totalLabel, ...metricValues(member)]);
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
    formatTable(sheet, 4, [8, 10, 12, 16, 18], [19, 20, 21, 22]);
    sheet.columns = headers.map((label, index) => ({ width: index === 0 ? 13 : label.includes("率") ? 11 : label.includes("美元") || label.includes("业绩") ? 15 : 12 }));
  }
  return workbook;
}
