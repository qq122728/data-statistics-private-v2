import ExcelJS from "exceljs";
import type { ResourceAnalysis } from "./analysis";

// Backend export uses only the validated query snapshot; no model-provided cells.
export function analysisWorkbook(a: ResourceAnalysis & { scopeNote?: string }, basis: string) {
  if (a.details.length + a.trends.length + a.maturity.length > 10000) throw Error("分析明细超过10000行，请缩小范围后导出");
  const book = new ExcelJS.Workbook(); book.creator = "资源参谋";
  const summary = book.addWorksheet("日报与口径");
  summary.addRows([["项目", "内容"], ["范围", basis], ["权限范围", a.scopeNote || ""], ["说明", "资金按实际日期；7/30/60日仅完整观察窗；同号跨组保留业务记录；非到账凭证核验；不自动调整预算。"],
    ["所选期间首充 USD", a.totals.firstCents / 100], ["所选期间续充 USD", a.totals.rechargeCents / 100], ["所选期间出金 USD", a.totals.withdrawalCents / 100], ["所选期间净业绩 USD", a.totals.netCents / 100],
    ...Object.entries(a.buckets).map(([k, c]) => [k + "净业绩 USD", c.netCents / 100]),
    ["阈值", "相对下降≥10%为严重预警。转化样本两期各≥30；续充同龄开单样本各≥10。数量基准期≥10次，续充金额基准期≥10位续充客户；同比对去年、月环比对上月；不代表连续异常。"]]);
  const warnings = book.addWorksheet("预警依据与建议");
  warnings.addRow(["级别", "事项", "依据", "建议"]); for (const w of a.warnings) warnings.addRow([w.level, w.title, w.evidence, w.action]);
  const cohorts = book.addWorksheet("开单月份贡献");
  cohorts.addRow(["登记开单月份", "有首充金额记录数", "对照期首充 USD", "对照期续充 USD", "对照期净业绩 USD", "本期首充 USD", "本期续充 USD", "本期净业绩 USD"]);
  for (const c of a.cohorts) cohorts.addRow([c.month, c.customerCount, c.previous.firstCents / 100, c.previous.rechargeCents / 100, c.previous.netCents / 100, c.current.firstCents / 100, c.current.rechargeCents / 100, c.current.netCents / 100]);
  const maturity = book.addWorksheet("开单同龄表现");
  maturity.addRow(["开单月份", "观察天数", "已满观察期人数", "未满观察期人数", "续充人数", "续充率", "首充 USD", "续充 USD", "出金 USD", "净业绩 USD"]);
  for (const c of a.maturity) maturity.addRow([c.month, c.windowDays, c.eligible, c.immature, c.eligible ? c.renewed : null, c.eligible ? c.renewed / c.eligible : null, c.eligible ? c.firstCents / 100 : null, c.eligible ? c.rechargeCents / 100 : null, c.eligible ? c.withdrawalCents / 100 : null, c.eligible ? (c.firstCents + c.rechargeCents - c.withdrawalCents) / 100 : null]);
  maturity.getColumn(6).numFmt = "0.0%";
  const trends = book.addWorksheet("成熟批次对比");
  trends.addRow(["范围", "指标", "对比方式", "观察天数", "本期样本", "对照样本", "本期值", "对照值", "单位", "相对降幅", "本期开始", "本期结束", "对照开始", "对照结束"]);
  for (const t of a.trends) trends.addRow([t.scope, t.metric, t.comparison, t.ageDays, t.currentN, t.previousN, t.currentValue, t.previousValue, t.unit === "rate" ? "比例（0至1）" : t.unit, t.declineRelative, t.currentFrom, t.currentTo, t.previousFrom, t.previousTo]);
  trends.getColumn(10).numFmt = "0.0%";
  const detail = book.addWorksheet("本期资金号码");
  detail.addRow(["完整号码", "小组", "渠道", "投手/供应方", "国家", "接粉日期", "登记开单日期", "开单批次", "本期首充 USD", "本期续充 USD", "本期出金 USD", "本期净业绩 USD"]);
  for (const d of a.details) detail.addRow([d.phone, d.group, d.channel, d.buyer, d.country, d.intakeOn, d.openedOn, d.bucket, d.firstCents / 100, d.rechargeCents / 100, d.withdrawalCents / 100, d.netCents / 100]);
  detail.getColumn(1).numFmt = "@";
  for (const [sheet, start, end] of [[cohorts, 3, 8], [maturity, 7, 10], [detail, 9, 12]] as const) for (let i = start; i <= end; i++) sheet.getColumn(i).numFmt = "#,##0.00";
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
    sheet.columns.forEach(c => { c.width = 24; });
    sheet.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } }; });
  }
  summary.getColumn(2).width = 95; summary.getColumn(2).alignment = { wrapText: true };
  for (const i of [2, 3, 4]) { warnings.getColumn(i).width = i === 2 ? 48 : 90; warnings.getColumn(i).alignment = { wrapText: true }; }
  trends.getColumn(1).width = 70;
  return book;
}
