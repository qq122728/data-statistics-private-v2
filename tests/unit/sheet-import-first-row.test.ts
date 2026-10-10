import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { ImportHeaderChoiceError, prepareNumberImport } from "../../packages/customer-sheet/number-import";
import { parseSheetText } from "../../packages/customer-sheet/clipboard";
import { readImportWorkbook } from "../../src/lib/sheet-import-workbook";

const phones = Array.from({ length: 17 }, (_, i) => `009988${String(i).padStart(5, "0")}`);

describe("客户导入保留第一行", () => {
  it.each(["\t", ",", ";"])("17个号码带空列（%s）仍完整读取", delimiter => {
    const raw = parseSheetText(phones.map(phone => `${delimiter}${phone}${delimiter}`).join("\n"));
    const result = prepareNumberImport(raw);
    expect(result.firstDataRowIndex).toBe(0);
    expect(result.matrix).toEqual([["客户号码"], ...phones.map(phone => [phone])]);
  });

  it.each(["blank", "styled"])("Excel空列 %s 不会吞掉第一位客户，来源行正确", kind => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("名单");
    phones.forEach((phone, i) => { sheet.getCell(i + 3, 1).value = phone; });
    if (kind === "blank") sheet.getCell("B3").value = "";
    else sheet.getCell("B3").font = { bold: true };
    const result = readImportWorkbook(workbook, true);
    expect(result.rows.map(row => row[0])).toEqual(phones);
    expect(result.sources[0]).toMatchObject({ sheet: "名单", row: 3 });
    expect(result.sources.at(-1)?.row).toBe(19);
  });

  it("多列没有标题时先要求确认，选择客户后保留全部行", () => {
    const matrix = phones.map(phone => [phone, "JH"]);
    expect(() => prepareNumberImport(matrix)).toThrow(ImportHeaderChoiceError);
    expect(prepareNumberImport(matrix, "customer").matrix).toEqual([["客户号码", "第2列"], ...matrix]);
  });

  it("首行有号码且备注恰好含标题词时不能当作表头丢弃", () => {
    const matrix = [[phones[0], "phone"], [phones[1], "备注"]];
    expect(() => prepareNumberImport(matrix)).toThrow(ImportHeaderChoiceError);
    expect(prepareNumberImport(matrix, "customer").matrix.slice(1)).toEqual(matrix);
  });

  it("未知标题不猜测；确认是标题后才跳过第一行", () => {
    const matrix = [["联系号码", "来源"], ...phones.map(phone => [phone, "JH"])];
    expect(() => prepareNumberImport(matrix)).toThrow("第一行是标题还是客户");
    expect(prepareNumberImport(matrix, "header")).toEqual({ matrix, firstDataRowIndex: 1 });
  });

  it("首行号码无效也要保留给后续校验，不能当作标题丢掉", () => {
    const matrix = [["无法识别"], [phones[0]]];
    expect(() => prepareNumberImport(matrix)).toThrow(ImportHeaderChoiceError);
    expect(prepareNumberImport(matrix, "customer").matrix.slice(1)).toEqual(matrix);
  });

  it("已有标题及数据列保留，不能因为首行空白丢掉后续有内容的列", () => {
    const matrix = [["客户号码", "", "备注"], [phones[0], "JH", "保留备注"]];
    expect(prepareNumberImport(matrix)).toEqual({ matrix, firstDataRowIndex: 1 });
  });

  it("多工作表分别确认第一行，不改变其他表的标题或原始行号", () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("标准表").addRows([["客户号码"], [phones[0]]]);
    workbook.addWorksheet("无标题表").addRows([[phones[1], "JH"], [phones[2], "JH"]]);
    expect(() => readImportWorkbook(workbook, true)).toThrow("无标题表");
    const result = readImportWorkbook(workbook, true, { 无标题表: "customer" });
    expect(result.rows.map(row => row[0])).toEqual(phones.slice(0, 3));
    expect(result.sources.map(source => source.row)).toEqual([2, 1, 2]);
  });
});
