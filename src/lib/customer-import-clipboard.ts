export type ClipboardDevice = { id: string; code: string };

export type ClipboardImportRow = {
  id: string;
  phone: string;
  customerName: string;
  customerEmail: string;
  deviceMode: "SELECT" | "MANUAL";
  deviceId: string;
  deviceCode: string;
  lossAmount: string;
  customerPlatform: string;
  notes: string;
};

/**
 * Excel 复制到网页时，单元格以 Tab、行以换行分隔。
 * 自己的导入表列顺序为：编号、姓名、邮箱、设备号、金额、平台、备注。
 * 如果 Excel 有列名，则按列名识别；这样也能直接粘贴被骗资料表。
 */
export function parseCustomerImportClipboard(
  raw: string,
  devices: ClipboardDevice[],
  createId: (index: number) => string,
): { rows: ClipboardImportRow[]; errors: string[] } {
  return parseCustomerImportRows(
    raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split("\t")),
    devices,
    createId,
  );
}

/**
 * 给剪贴板和 Excel / CSV 文件共用的资料表解析器。
 * 有列名时按列名读；没有列名时保留原来的录入顺序兼容逻辑。
 */
export function parseCustomerImportRows(
  rawRows: string[][],
  devices: ClipboardDevice[],
  createId: (index: number) => string,
): { rows: ClipboardImportRow[]; errors: string[] } {
  const sourceRows = rawRows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some((cell) => cell));
  const first = sourceRows[0] ?? [];
  const headerMap = headerColumnMap(first);
  const dataRows = headerMap ? sourceRows.slice(1) : sourceRows;
  const deviceByCode = new Map(devices.map((device) => [device.code.trim(), device]));
  const rows: ClipboardImportRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((cells, index) => {
    const record = headerMap
      ? readHeaderRecord(cells, headerMap)
      : cells.length === 1
        ? readPlainFraudRecord(cells[0])
        : isHeaderlessFraudRecord(cells)
          ? readHeaderlessFraudRecord(cells)
        : readLegacyRecord(cells);
    const amount = normalizeAmount(record.rawAmount);
    if (record.rawAmount.trim() && amount === null) {
      errors.push(`第 ${index + 1} 行：客户金额不是有效数字`);
      return;
    }
    const normalizedDeviceCode = record.deviceCode.trim();
    const device = normalizedDeviceCode ? deviceByCode.get(normalizedDeviceCode) : undefined;
    rows.push({
      id: createId(index),
      phone: record.phone.trim(),
      customerName: record.customerName.trim(),
      customerEmail: record.customerEmail.trim().toLowerCase(),
      deviceMode: device ? "SELECT" : normalizedDeviceCode ? "MANUAL" : "SELECT",
      deviceId: device?.id ?? "",
      deviceCode: device ? "" : normalizedDeviceCode,
      lossAmount: amount === null ? "" : String(amount),
      customerPlatform: record.customerPlatform.trim(),
      notes: record.notes.trim(),
    });
  });

  return { rows, errors };
}

type ClipboardRecord = {
  phone: string;
  customerName: string;
  customerEmail: string;
  deviceCode: string;
  rawAmount: string;
  customerPlatform: string;
  notes: string;
};

type HeaderColumnMap = Partial<Record<keyof ClipboardRecord, number>> & { whatsapp?: number };

function headerColumnMap(headers: string[]): HeaderColumnMap | null {
  const map: HeaderColumnMap = {};
  headers.forEach((header, index) => {
    const value = header.replace(/[\s（）()_$／/\\:：_-]/g, "").toLowerCase();
    if (["客户编号", "客户号码", "手机号", "phone"].includes(value)) map.phone = index;
    else if (["whatsapp", "ws号码", "whatsapp手机号"].includes(value)) map.whatsapp = index;
    else if (["客户姓名", "客户名字", "姓名", "name"].includes(value)) map.customerName = index;
    else if (["邮箱", "email"].includes(value)) map.customerEmail = index;
    else if (["前台接粉设备号", "设备号", "device"].includes(value)) map.deviceCode = index;
    else if (["被骗金额", "被骗金额美元", "客户金额", "客户金额美元", "金额", "amount"].includes(value)) map.rawAmount = index;
    else if (["被骗平台", "客户平台", "平台", "platform"].includes(value)) map.customerPlatform = index;
    else if (["备注", "note"].includes(value)) map.notes = index;
  });
  return Object.keys(map).length ? map : null;
}

function readHeaderRecord(cells: string[], map: HeaderColumnMap): ClipboardRecord {
  const read = (column?: number) => column === undefined ? "" : (cells[column] ?? "").trim();
  const whatsapp = read(map.whatsapp).replace(/\D/g, "");
  return {
    phone: map.whatsapp === undefined ? read(map.phone) : whatsapp.slice(-6),
    customerName: read(map.customerName),
    customerEmail: read(map.customerEmail),
    deviceCode: read(map.deviceCode),
    rawAmount: read(map.rawAmount),
    customerPlatform: read(map.customerPlatform),
    notes: read(map.notes),
  };
}

function readLegacyRecord(cells: string[]): ClipboardRecord {
  // 旧版本的无表头粘贴顺序仍可使用：编号、姓名、设备号、金额、平台、备注。
  const [phone = "", customerName = "", deviceCode = "", rawAmount = "", customerPlatform = "", ...noteParts] = cells;
  return { phone, customerName, customerEmail: "", deviceCode, rawAmount, customerPlatform, notes: noteParts.join("\t") };
}

function isHeaderlessFraudRecord(cells: string[]) {
  return cells.length >= 5 && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(cells[2]?.trim() ?? "");
}

function readHeaderlessFraudRecord(cells: string[]): ClipboardRecord {
  const [rawAmount = "", customerPlatform = "", customerEmail = "", customerName = "", whatsapp = "", ...noteParts] = cells;
  return {
    phone: whatsapp.replace(/\D/g, "").slice(-6),
    customerName,
    customerEmail,
    deviceCode: "",
    rawAmount,
    customerPlatform,
    notes: noteParts.join("\t"),
  };
}

function readPlainFraudRecord(value: string): ClipboardRecord {
  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?:com|net|org|edu|gov|de|fr|it|es|uk|cn|jp|io|co|info|biz)(?=$|[\s\d]|[A-Z][a-z])/i);
  if (!emailMatch || emailMatch.index === undefined) return readLegacyRecord([value]);
  let email = emailMatch[0];
  let beforeEmail = value.slice(0, emailMatch.index);
  // 有些资料把平台末尾的 “AG” 和邮箱首字母粘在一起。仅在 “两位大写 + 小写邮箱”
  // 的明确形态下拆开，避免把普通邮箱误拆。
  const [localPart, domainPart] = email.split("@");
  const attachedPlatformSuffix = localPart.match(/^([A-Z]{2})([a-z][A-Za-z0-9._%+-]*)$/);
  if (attachedPlatformSuffix) {
    beforeEmail += attachedPlatformSuffix[1];
    email = `${attachedPlatformSuffix[2]}@${domainPart}`;
  }
  beforeEmail = beforeEmail.trim();
  const afterEmail = value.slice(emailMatch.index + emailMatch[0].length).trim();
  const phoneMatch = afterEmail.match(/(\d[\d\s-]{5,})\s*$/);
  const phone = phoneMatch ? phoneMatch[1].replace(/\D/g, "").slice(-6) : "";
  const customerName = phoneMatch ? afterEmail.slice(0, phoneMatch.index).trim() : afterEmail;
  const amountMatch = beforeEmail.match(/^\s*([$€¥]?\s*[\d.,]+(?:\s*(?:usd|eur|euro|美元))?)\s*(.*)$/i);
  return {
    phone,
    customerName,
    customerEmail: email,
    deviceCode: "",
    rawAmount: amountMatch?.[1] ?? "",
    customerPlatform: amountMatch?.[2] ?? beforeEmail,
    notes: "",
  };
}

function normalizeAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let normalized = trimmed.replace(/(?:usd|eur|euro|美元)/gi, "").replace(/[$€¥\s]/g, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(normalized)) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else normalized = normalized.replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}
