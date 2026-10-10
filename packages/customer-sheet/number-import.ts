export type HeaderChoice = "header" | "customer";
export type HeaderQuestion = { sheet: string; firstRow: string[] };

export class ImportHeaderChoiceError extends Error {
  question: HeaderQuestion;
  constructor(sheet: string, firstRow: string[]) {
    super(`无法确认“${sheet}”的第一行是标题还是客户。请在客户表导入窗口确认第一行的用途，名单尚未保存。`);
    this.question = { sheet, firstRow: firstRow.map(value => value.slice(0, 80)) };
  }
}

const phoneHeaders = ["号码", "客户号码", "手机号", "手机号码", "电话号码", "进群客户", "phone"];
const isPhone = (value: string) => /^\d{6,20}$/.test(value.replace(/[\s()+-]/g, ""));

/** Discard only wholly empty columns; never silently discard a possible customer. */
export function prepareNumberImport(input: string[][], choice?: HeaderChoice, sheet = "名单") {
  const width = input.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = Array.from({ length: width }, (_, i) => i).filter(i => input.some(row => row[i]?.trim()));
  const matrix = input.map(row => columns.map(i => (row[i] ?? "").trim()));
  if (!matrix.length || !columns.length) return { matrix: [] as string[][], firstDataRowIndex: 0 };
  const first = matrix[0];
  const recognizedHeader = first.some(value => phoneHeaders.includes(value.toLowerCase())) && !first.some(isPhone);
  const singlePhoneColumn = first.length === 1 && isPhone(first[0]);
  const resolved = choice ?? (recognizedHeader ? "header" : singlePhoneColumn ? "customer" : undefined);
  if (!resolved) throw new ImportHeaderChoiceError(sheet, first);
  if (resolved === "header") return { matrix, firstDataRowIndex: 1 };
  const phoneColumns = first.flatMap((value, i) => isPhone(value) ? [i] : []);
  const phoneColumn = first.length === 1 ? 0 : phoneColumns.length === 1 ? phoneColumns[0] : -1;
  const headers = first.map((_, i) => i === phoneColumn ? "客户号码" : `第${i + 1}列`);
  return { matrix: [headers, ...matrix], firstDataRowIndex: 0 };
}
