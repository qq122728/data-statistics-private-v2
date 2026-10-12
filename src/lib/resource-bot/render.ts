import ExcelJS from "exceljs";
import { renderAnalysis } from "./analysis";
import { analysisWorkbook } from "./analysis-workbook";
import type { ResourceQuery } from "./query";
import { countryName } from "./query";
import type { BotDetail, ResourceBotData } from "./data";
import type { BuyerReportRow } from "../resource-buyer-report";

const clean = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .slice(0, 100);
const money = (n: number) =>
  (n / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const rate = (n: number, d: number) =>
  d ? `${((n / d) * 100).toFixed(1)}%` : "—";
const status: Record<string, string> = {
  matched: "已匹配",
  pending: "未匹配业务",
  ambiguous: "归属待核对",
  unattributed: "未登记投手",
};
const PAGE_SIZE = 5;
export function reportBasis(q: ResourceQuery, data: ResourceBotData) {
  const dates = data.range
    ? `${data.range.from} 至 ${data.range.to}`
    : "全部日期";
  const filter = [
    q.type === "ADS" ? "投流" : q.type === "SMS" ? "短信" : "投流＋短信",
    q.channel,
    q.buyer,
    q.country && countryName(q.country),
    q.material,
  ]
    .filter(Boolean)
    .map(clean)
    .join(" / ");
  return `${dates}｜${filter}\n${q.view === "analysis" ? "按实际资金日期；客户按首次开单月份分组，成熟批次只比相同观察天数。" : q.view === "orders" ? "按实际开单日期筛选；金额为所列号码累计。" : q.view === "phone" ? "号码累计详情；不同小组或渠道的同号分行展示。" : "按号码导入日期筛选；转化和金额为这批号码累计。消耗按同期间登记日期。"}\n业务金额单位 USD；消耗按登记币种分开。`;
}
function label(r: BuyerReportRow, q: ResourceQuery) {
  return [
    q.dimension !== "country" && `${r.channel} · ${r.channelId.slice(-5)}`,
    q.dimension !== "channel" && countryName(r.country),
    q.dimension !== "channel" && q.dimension !== "country" && r.buyer,
    q.dimension === "material" && r.material,
  ]
    .filter(Boolean)
    .map((s) => clean(String(s)))
    .join("｜");
}
function costs(r: BuyerReportRow) {
  return r.spend.length
    ? r.spend
        .map(
          (s) =>
            `${s.currency} 消耗 ${money(s.amountCents)}，单粉 ${r.imported ? money(s.amountCents / r.imported) : "—"}，有效粉 ${r.valid ? money(s.amountCents / r.valid) : "—"}，开单成本 ${r.opened ? money(s.amountCents / r.opened) : "—"}`,
        )
        .join("\n")
    : "消耗未登记，成本暂无法计算";
}
function detailText(d: BotDetail) {
  const m = d.metrics;
  return `${clean(d.phone)}｜${clean(d.channel)} · ${d.channelId.slice(-5)}｜${clean(d.buyer)}\n${clean(d.group) || "未匹配小组"}｜${countryName(d.country)}｜${status[d.status] || d.status}\n接粉 ${d.intakeOn || "—"}；进群 ${d.joinedOn || "—"}\n推专家 ${d.expertOn || "—"}；注册 ${d.registeredOn || "—"}；开单 ${d.openedOn || "—"}\n${m ? `首充 $${money(m.firstCents)}；续充 $${money(m.rechargeCents)}；出金 $${money(m.withdrawalCents)}；净业绩 $${money(m.netCents)}${m.legacyCents ? `（含历史金额 $${money(m.legacyCents)}）` : ""}` : "未匹配到唯一业务记录，金额暂无法确认"}`;
}
export function renderResourceReport(
  q: ResourceQuery,
  data: ResourceBotData,
): string {
  if (data.analysis) return renderAnalysis(data.analysis, [q.type === "ALL" ? "投流＋短信" : q.type === "ADS" ? "投流" : "短信", q.channel, q.buyer, q.country, q.material].filter(Boolean).join(" / ")) + "\n" + data.analysis.scopeNote;
  const head = `资源参谋｜${q.view === "orders" ? "开单号码" : q.view === "phone" ? "号码详情" : q.view === "issues" ? "待核对事项" : "效果统计"}\n${reportBasis(q, data)}`;
  if (q.view === "issues") {
    const pending = data.details.filter((d) => d.status === "pending").length;
    const ambiguous = data.details.filter(
      (d) => d.status === "ambiguous",
    ).length;
    const missing = data.summary.filter(
      (r) => !r.spend.length && r.imported > 0,
    );
    const empty = data.summary.filter((r) => r.spend.length && !r.imported);
    return `${head}\n\n待匹配 ${pending} 个；归属冲突 ${ambiguous} 个\n未登记消耗 ${missing.length} 项；有消耗但无导入 ${empty.length} 项\n当前渠道范围另有 ${data.unattributed} 条业务记录未登记投手（全部日期）。\n${missing
      .slice(0, 5)
      .map((r) => "• 未登记消耗：" + label(r, q))
      .join("\n")}\n可加“导出 Excel”查看导入号码、匹配状态和各项消耗。`;
  }
  const isDetails = q.view === "phone" || q.view === "orders";
  const all = isDetails ? data.details : data.summary;
  if (!all.length)
    return `${head}\n\n未找到符合条件的${isDetails ? "号码" : "导入或消耗记录"}。${!isDetails && data.unattributed ? `当前渠道还有 ${data.unattributed} 条业务记录未登记投手，不能据此认定没有业务开单。可问“本月开单号码”。` : ""}`;
  const pages = Math.ceil(all.length / PAGE_SIZE);
  if (q.page > pages) return `${head}\n\n共 ${pages} 页，已到最后一页。`;
  const start = (q.page - 1) * PAGE_SIZE;
  const items = isDetails
    ? data.details.slice(start, start + PAGE_SIZE).map(detailText)
    : data.summary
        .slice(start, start + PAGE_SIZE)
        .map(
          (r) =>
            `${label(r, q)}\n导入 ${r.imported} / 匹配 ${r.matched} / 有效 ${r.valid} / 回复 ${r.replied}\n进群 ${r.joined} / 推专家 ${r.expert} / 注册 ${r.registered} / 开单 ${r.opened}（${rate(r.opened, r.matched)}）\n首充 $${money(r.firstCents)} / 续充 $${money(r.rechargeCents)} / 净业绩 $${money(r.netCents)}\n${costs(r)}${r.matched < 20 ? "\n样本不足 20，暂不据此判断优劣。" : ""}`,
        );
  return `${head}\n\n${items.join("\n\n")}\n\n共 ${all.length} ${isDetails ? "条业务/归属记录" : "项"}，第 ${q.page}/${pages} 页。${pages > q.page ? " @我说“下一页”继续。" : ""}\n可 @我说“导出 Excel”。开单率＝开单/匹配；单粉成本＝消耗/导入。`;
}
function style(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: sheet.rowCount, column: sheet.columnCount },
  };
  sheet.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
  });
  sheet.columns.forEach((c) => {
    c.width = 20;
  });
}
function createResourceWorkbook(
  q: ResourceQuery,
  data: ResourceBotData,
): ExcelJS.Workbook {
  if (data.analysis) return analysisWorkbook(data.analysis, reportBasis(q, data));
  if (
    data.details.length > 5000 ||
    data.summary.length > 5000 ||
    data.spends.length > 5000
  )
    throw Error("一次最多导出 5000 条，请缩小渠道、投手或日期范围");
  const book = new ExcelJS.Workbook();
  book.creator = "资源参谋";
  const note = book.addWorksheet("查询说明");
  note.addRows([
    ["项目", "说明"],
    ["查询口径", reportBasis(q, data)],
    [
      "费用口径",
      "单粉成本＝消耗/导入；有效粉成本＝消耗/有效；开单成本＝消耗/开单。没有消耗记录或分母为0留空。",
    ],
    ["开单率", "开单人数/匹配人数。投手效果按导入批次筛选，金额累计。"],
    ["去重", "渠道＋号码匹配；同号多个业务记录且未指定小组时不归给投手。"],
    ["未知值", "号码无唯一业务匹配，业务指标与金额留空；不当作0。"],
  ]);
  note.getColumn(2).width = 100;
  note.getColumn(2).alignment = { wrapText: true };
  if (q.view !== "phone" && q.view !== "orders") {
    const s = book.addWorksheet("效果汇总");
    s.addRow([
      "渠道",
      "渠道编号",
      "投手/供应方",
      "国家",
      "素材",
      "导入",
      "匹配",
      "待匹配",
      "归属冲突",
      "有效",
      "回复",
      "进群",
      "推专家",
      "注册",
      "开单",
      "开单率",
      "首充 USD",
      "续充 USD",
      "出金 USD",
      "历史金额 USD",
      "净业绩 USD",
    ]);
    for (const r of data.summary)
      s.addRow([
        r.channel,
        r.channelId,
        r.buyer,
        countryName(r.country),
        q.dimension === "material" ? r.material : "全部素材",
        r.imported,
        r.matched,
        r.pending,
        r.ambiguous,
        r.valid,
        r.replied,
        r.joined,
        r.expert,
        r.registered,
        r.opened,
        r.matched ? r.opened / r.matched : null,
        r.firstCents / 100,
        r.rechargeCents / 100,
        r.withdrawalCents / 100,
        r.legacyCents / 100,
        r.netCents / 100,
      ]);
    s.getColumn(16).numFmt = "0.0%";
    for (let i = 17; i <= 21; i++) s.getColumn(i).numFmt = "#,##0.00";
    style(s);
    const cost = book.addWorksheet("消耗与成本");
    cost.addRow([
      "渠道",
      "投手/供应方",
      "国家",
      "素材",
      "币种",
      "消耗",
      "导入",
      "有效",
      "开单",
      "单粉成本",
      "有效粉成本",
      "开单成本",
      "登记状态",
    ]);
    for (const r of data.summary) {
      for (const expense of r.spend.length ? r.spend : [null])
        cost.addRow([
          r.channel,
          r.buyer,
          countryName(r.country),
          q.dimension === "material" ? r.material : "全部素材",
          expense?.currency || "",
          expense ? expense.amountCents / 100 : null,
          r.imported,
          r.valid,
          r.opened,
          expense && r.imported ? expense.amountCents / 100 / r.imported : null,
          expense && r.valid ? expense.amountCents / 100 / r.valid : null,
          expense && r.opened ? expense.amountCents / 100 / r.opened : null,
          expense ? "已登记" : "未登记",
        ]);
    }
    for (const i of [6, 10, 11, 12]) cost.getColumn(i).numFmt = "#,##0.00";
    style(cost);
  }
  const d = book.addWorksheet("号码明细");
  d.addRow([
    "完整号码",
    "渠道",
    "渠道编号",
    "投手/供应方",
    "国家",
    "素材",
    "导入日期",
    "小组",
    "匹配状态",
    "接粉日期",
    "进群日期",
    "推专家日期",
    "注册日期",
    "开单日期",
    "有效",
    "回复",
    "进群",
    "推专家",
    "注册",
    "开单",
    "首充 USD",
    "续充 USD",
    "出金 USD",
    "历史金额 USD",
    "净业绩 USD",
  ]);
  for (const r of data.details)
    d.addRow([
      String(r.phone),
      r.channel,
      r.channelId,
      r.buyer,
      countryName(r.country),
      r.material,
      r.sourceDate,
      r.group,
      status[r.status] || r.status,
      r.intakeOn,
      r.joinedOn,
      r.expertOn,
      r.registeredOn,
      r.openedOn,
      ...(
        [
          "valid",
          "replied",
          "joined",
          "expert",
          "registered",
          "opened",
        ] as const
      ).map((k) => (r.metrics ? Number(r.metrics[k]) : null)),
      ...(
        [
          "firstCents",
          "rechargeCents",
          "withdrawalCents",
          "legacyCents",
          "netCents",
        ] as const
      ).map((k) => (r.metrics ? r.metrics[k] / 100 : null)),
    ]);
  d.getColumn(1).numFmt = "@";
  for (let i = 21; i <= 25; i++) d.getColumn(i).numFmt = "#,##0.00";
  style(d);
  return book;
}

export async function exportResourceReport(q: ResourceQuery, data: ResourceBotData): Promise<Uint8Array> {
  return new Uint8Array(await createResourceWorkbook(q, data).xlsx.writeBuffer());
}

export type ResourceReportSnapshot = { query: ResourceQuery; data: ResourceBotData };

// Only validated database snapshots enter this workbook. The model supplies IDs, never cells,
// formulas, file paths or arbitrary code. Overlapping reports are not added into a grand total.
export async function exportResourceWorkbook(reports: ResourceReportSnapshot[]): Promise<Uint8Array> {
  if (!reports.length || reports.length > 4) throw Error("一份综合表支持1至4份查询结果");
  if (reports.reduce((n, r) => n + r.data.details.length + r.data.summary.length + (r.data.analysis ? r.data.analysis.details.length + r.data.analysis.trends.length + r.data.analysis.maturity.length : 0), 0) > 10000)
    throw Error("综合表最多10000行，请缩小查询范围");
  const book = new ExcelJS.Workbook();
  book.creator = "资源参谋";
  const index = book.addWorksheet("报表目录");
  index.addRow(["报表", "范围与统计口径", "汇总项数", "号码记录数"]);
  const comparison = book.addWorksheet("对比汇总");
  comparison.addRow(["报表", "导入", "匹配记录", "有效", "回复", "进群", "推专家", "注册", "开单", "开单率", "首充 USD", "续充 USD", "出金 USD", "净业绩 USD"]);
  for (const [i, { query, data }] of reports.entries()) {
    const name = `报表${i + 1}`;
    index.addRow([name, reportBasis(query, data), data.analysis?.cohorts.length ?? data.summary.length, data.analysis?.details.length ?? data.details.length]);
    const detailView = ["phone", "orders"].includes(query.view);
    const fields = ["valid", "replied", "joined", "expert", "registered", "opened", "firstCents", "rechargeCents", "withdrawalCents", "netCents"] as const;
    const values = fields.map(field => detailView
      ? data.details.reduce((n, d) => n + Number(d.metrics?.[field] || 0), 0)
      : data.summary.reduce((n, r) => n + r[field], 0));
    const matched = detailView ? data.details.filter(d => d.metrics).length : data.summary.reduce((n, r) => n + r.matched, 0);
    if (data.analysis) comparison.addRow([name + "（当期流水）", null, null, null, null, null, null, null, data.analysis.totals.newOrders, null, data.analysis.totals.firstCents / 100, data.analysis.totals.rechargeCents / 100, data.analysis.totals.withdrawalCents / 100, data.analysis.totals.netCents / 100]);
    else comparison.addRow([name, detailView ? null : data.summary.reduce((n, r) => n + r.imported, 0), matched,
      ...values.slice(0, 6), matched ? values[5] / matched : null, ...values.slice(6).map(v => v / 100)]);
    const source = createResourceWorkbook(query, data);
    for (const sheet of source.worksheets) {
      const target = book.addWorksheet(`${i + 1}-${sheet.name}`);
      target.columns = sheet.columns.map(c => ({ width: c.width, style: c.style }));
      sheet.eachRow((row, rowIndex) => row.eachCell({ includeEmpty: true }, (cell, col) => {
        const dest = target.getCell(rowIndex, col);
        dest.value = cell.value;
        dest.style = cell.style;
      }));
      target.views = sheet.views;
      target.autoFilter = sheet.autoFilter;
    }
  }
  index.addRow(["说明", "各报表可能包含相同号码，不跨报表加总。未匹配记录的金额和指标见明细空值；对比汇总仅合计可确认记录。分析日报为当期流水，其余报表金额为所列号码累计；不同口径不加总。费用按各报表币种分别列示。"]);
  style(index); style(comparison);
  index.getColumn(2).width = 100;
  index.getColumn(2).alignment = { wrapText: true };
  comparison.getColumn(10).numFmt = "0.0%";
  for (let col = 11; col <= 14; col++) comparison.getColumn(col).numFmt = "#,##0.00";
  return new Uint8Array(await book.xlsx.writeBuffer());
}
