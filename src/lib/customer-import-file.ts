import {
  parseCustomerImportRows,
  type ClipboardDevice,
  type ClipboardImportRow,
} from "./customer-import-clipboard";

type ParseResult = { rows: ClipboardImportRow[]; errors: string[] };

/**
 * CSV 与 xlsx 都先转成二维表格，再走和“从 Excel 粘贴”完全相同的列名识别规则。
 * 因此文件导入只会填到预览区，不会绕过现有的查重和最终确认步骤。
 */
export async function parseCustomerImportFile(
  file: File,
  devices: ClipboardDevice[],
  createId: (index: number) => string,
): Promise<ParseResult> {
  const fileName = file.name.toLowerCase();
  if (file.size > 10 * 1024 * 1024) return { rows: [], errors: ["文件不能超过 10MB"] };

  if (fileName.endsWith(".csv")) return parseCustomerImportCsv(await file.text(), devices, createId);
  if (!fileName.endsWith(".xlsx")) return { rows: [], errors: ["只支持 .xlsx 或 .csv 文件"] };

  try {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return { rows: [], errors: ["Excel 文件中没有可读取的工作表"] };
    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = Array.from({ length: row.cellCount }, (_, index) => row.getCell(index + 1).text);
      matrix.push(cells);
    });
    return parseCustomerImportRows(matrix, devices, createId);
  } catch {
    return { rows: [], errors: ["Excel 文件无法读取，请确认文件没有损坏或设置密码"] };
  }
}

export function parseCustomerImportCsv(
  raw: string,
  devices: ClipboardDevice[],
  createId: (index: number) => string,
): ParseResult {
  return parseCustomerImportRows(parseDelimitedRows(raw.replace(/^\uFEFF/, "")), devices, createId);
}

function parseDelimitedRows(raw: string): string[][] {
  const delimiter = detectDelimiter(raw);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '"') {
      if (quoted && raw[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && raw[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function detectDelimiter(raw: string) {
  const header = raw.split(/\r?\n/, 1)[0] ?? "";
  return (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
}
