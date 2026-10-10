import { invalidQuality, validQualityMessage } from "../../packages/customer-sheet/valid-quality";
import type ExcelJS from "exceljs";
import { prepareNumberImport, type HeaderChoice } from "../../packages/customer-sheet/number-import";

export type ImportStage = "pending" | "group" | "expert";
const stages: Record<string, ImportStage> = { "待进群": "pending", "在群跟进": "group", "专家跟进": "expert" };

export function isTemplateExample(headers: string[], cells: string[]) {
  const index = headers.indexOf("模板说明（可删除）");
  return index >= 0 && (cells[index] ?? "").startsWith("【示例，不导入】");
}

// A template's prefilled quality is not a customer until another field is filled.
export function isDefaultQualityRow(headers: string[], cells: string[]) {
  const index = headers.indexOf("号码情况");
  return index >= 0 && cells[index]?.trim() === "有效" && cells.every((value, i) => i === index || !value.trim());
}

export function assertImportQuality(headers: string[], cells: string[], location: string) {
 for (let i=0; i<headers.length; i++) if (["号码情况","号码质量","quality"].includes(headers[i].trim()) && invalidQuality(cells[i])) throw Error(`${location}：${validQualityMessage}`);
}

export function importRowStage(headers: string[], cells: string[], location: string, fallback: ImportStage | null = null) {
  const index = headers.indexOf("业务阶段");
  if (index < 0) return fallback;
  const value = (cells[index] ?? "").trim();
  if (!Object.hasOwn(stages, value)) throw Error(`${location}：请选择业务阶段（待进群、在群跟进、专家跟进）`);
  return stages[value];
}

/** Read every business sheet. Preserve its stage and original Excel row for preview. */
export function readImportWorkbook(workbook: ExcelJS.Workbook, numbers: boolean, headerChoices: Record<string, HeaderChoice> = {}) {
  let skippedExamples = 0;
  const headers: string[] = [];
  const records: { cells: string[]; headers: string[]; sheet: string; row: number; stage: ImportStage | null }[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.name === "填写说明" || sheet.name === "_本组人员") continue;
    const matrix: string[][] = [];
    const rowNumbers: number[] = [];
    if (sheet.columnCount > 60) throw Error(`工作表“${sheet.name}”超过60列`);
    sheet.eachRow(row => {
      const cells = Array.from({ length: sheet.columnCount }, (_, i) => {
        const cell = row.getCell(i + 1);
        if (cell.value instanceof Date) {
          const iso = cell.value.toISOString();
          return iso.slice(11, 19) === "00:00:00" ? iso.slice(0, 10) : iso.slice(0, 19);
        }
        return cell.text.trim();
      });
      if (cells.some(Boolean)) { matrix.push(cells); rowNumbers.push(row.number); }
    });
    if (!matrix.length) continue;
    const prepared = numbers ? prepareNumberImport(matrix, Object.hasOwn(headerChoices, sheet.name) ? headerChoices[sheet.name] : undefined, sheet.name) : { matrix, firstDataRowIndex: 1 };
    const normalized = prepared.matrix;
    const sheetHeaders = normalized[0];
    if (new Set(sheetHeaders.filter(Boolean)).size !== sheetHeaders.filter(Boolean).length) throw Error(`工作表“${sheet.name}”有重复表头，请合并或改名`);
    for (const name of sheetHeaders) if (name && !headers.includes(name)) headers.push(name);
    normalized.slice(1).forEach((cells, i) => {
      if (isDefaultQualityRow(sheetHeaders, cells)) return;
      if (isTemplateExample(sheetHeaders, cells)) { skippedExamples++; return; }
      const row = rowNumbers[i + prepared.firstDataRowIndex];
      assertImportQuality(sheetHeaders, cells, `工作表“${sheet.name}”第${row}行`);
      records.push({ cells, headers: sheetHeaders, sheet: sheet.name, row, stage: importRowStage(sheetHeaders, cells, `工作表“${sheet.name}”第${row}行`, stages[sheet.name] ?? null) });
    });
    if (records.length > 500) throw Error("所有工作表合计最多500行，请分批导入");
  }
  if (!records.length) throw Error(skippedExamples ? "已跳过模板示例，尚未填写真实客户。请从第5行填写，或整行删除示例后填写。" : "模板还没有填写客户，请在客户导入表填写号码和业务阶段后上传");
  if (headers.length > 60) throw Error("所有工作表合计最多60种字段");
  return {
    skippedExamples,
    headers,
    rows: records.map(record => headers.map(name => record.cells[record.headers.indexOf(name)] ?? "")),
    sources: records.map(({ sheet, row, stage }) => ({ sheet, row, stage })),
    note: "已读取所有业务工作表，空白表及填写说明自动跳过；确认后才保存",
  };
}
