import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { baseColumns } from "../packages/customer-sheet/schema.ts";

const output = join(process.cwd(), "assets", "import-templates");
await mkdir(output, { recursive: true });

const unifiedHeaders = [
  "业务阶段", "客户号码", "模板说明（可删除）", "接粉日期", "渠道", "号码情况",
  "前台", "群操作员", "是否回复", "回复日期", "进群日期", "设备号码",
  "损失金额", "正常退群", "正常退群日期", "异常退群", "异常退群日期",
  "专家负责人", "已加专家日期", "提交资料", "追踪开始", "邀请注册",
  "已经开户", "客户情况备注", "客户情况跟进并备注", "首充",
  "首充 / 开单日期", "首充方式", "跟进安排",
];
const stageHeaders = {
  pending: ["客户号码", "接粉日期", "号码情况", "渠道", "前台", "是否回复", "回复日期", "客户情况备注"],
  group: ["客户号码", "接粉日期", "号码情况", "渠道", "前台", "是否回复", "回复日期", "进群日期", "群操作员", "设备号码", "客户情况备注"],
  expert: ["客户号码", "接粉日期", "号码情况", "渠道", "前台", "是否回复", "回复日期", "进群日期", "群操作员", "专家负责人", "已加专家日期", "提交资料", "追踪开始", "邀请注册", "已经开户", "首充", "首充 / 开单日期", "首充方式", "跟进安排"],
};

function decorate(sheet, headers, { unified = false } = {}) {
  sheet.addRow(headers);
  sheet.getRow(1).height = 30;
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EFF7" } };
    cell.font = { bold: true, color: { argb: "FF26364C" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  headers.forEach((name, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = name === "模板说明（可删除）" ? 65 : Math.max(18, name.length * 2 + 4);
    for (let row = 2; row <= 504; row++) {
      const cell = sheet.getCell(row, index + 1);
      if (name === "客户号码") cell.numFmt = "@";
      const choices = name === "业务阶段" ? ["待进群", "在群跟进", "专家跟进"]
        : baseColumns.find(c => c.name === name)?.options;
      if (choices?.length) cell.dataValidation = {
        type: "list", allowBlank: true, formulae: [`"${choices.join(",")}"`],
      };
    }
  });
  sheet.views = [{ state: "frozen", xSplit: unified ? 2 : 1, ySplit: 1 }];
}

for (const [stage, headers] of Object.entries(stageHeaders)) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet({ pending: "待进群", group: "在群跟进", expert: "专家跟进" }[stage]);
  decorate(sheet, headers);
  const help = workbook.addWorksheet("填写说明");
  help.addRow(["填写真实客户后上传；客户号码按文本保存，可保留开头的 0。"]);
  help.addRow(["导入前请核对接粉日期、渠道和本组负责人。"]);
  await workbook.xlsx.writeFile(join(output, `${stage}.xlsx`));
}

const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("客户导入");
decorate(sheet, unifiedHeaders, { unified: true });
const examples = ["待进群", "在群跟进", "专家跟进"];
examples.forEach((stage, index) => {
  sheet.getCell(index + 2, 1).value = stage;
  sheet.getCell(index + 2, 2).value = `000000010${index + 1}`;
  sheet.getCell(index + 2, 3).value = "【示例，不导入】请删除示例行，或从第 5 行开始填写真实客户。";
  sheet.getCell(index + 2, 6).value = "有效";
  sheet.getRow(index + 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6DC" } };
});
for (let row = 5; row <= 504; row++) sheet.getCell(row, 6).value = "有效";
await workbook.xlsx.writeFile(join(output, "unified.xlsx"));
