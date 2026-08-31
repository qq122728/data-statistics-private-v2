/**
 * 号码导入的粘贴解析。跟老系统的规则保持一致：
 * 从 Excel 复制粘贴过来是"列用 Tab 分隔、行用换行分隔"，
 * 支持"有表头"（认列名，顺序随意）和"无表头"（走固定旧格式）两种。
 * 没做老系统里那套专门识别"骗资料"无表头文本的兜底规则——比较冷门，先跳过。
 */

export type ParsedRow = {
  phone: string;
  name: string;
  email: string;
  amountUsd: number | null;
  platform: string;
  note: string;
};

export type ParseResult = {
  rows: ParsedRow[];
  errors: string[];
};

type FieldKey = "phone" | "whatsapp" | "name" | "email" | "amountUsd" | "platform" | "note";

function normalizeHeaderCell(s: string): string {
  return s.trim().toLowerCase().replace(/[\s()（）/:：\-－]/g, "");
}

const HEADER_MAP: Record<string, FieldKey> = {
  客户编号: "phone", 客户号码: "phone", 手机号: "phone", phone: "phone",
  whatsapp: "whatsapp", ws号码: "whatsapp", whatsapp手机号: "whatsapp",
  客户姓名: "name", 客户名字: "name", 姓名: "name", name: "name",
  邮箱: "email", email: "email",
  被骗金额: "amountUsd", 被骗金额美元: "amountUsd",
  客户金额: "amountUsd", 客户金额美元: "amountUsd", 金额: "amountUsd", amount: "amountUsd",
  被骗平台: "platform", 客户平台: "platform", 平台: "platform", platform: "platform",
  备注: "note", note: "note",
};

/** 无表头旧格式固定顺序：编号、姓名、设备号（导入这步不用，跳过）、金额、平台、备注 */
const LEGACY_ORDER: Array<FieldKey | null> = ["phone", "name", null, "amountUsd", "platform", "note"];

function normalizeAmount(raw: string): number | null | "invalid" {
  const s = raw.trim();
  if (!s) return null;
  let t = s.replace(/[$€¥]/g, "").replace(/usd|eur|euro|美元/gi, "").trim();
  const hasComma = t.includes(",");
  const hasDot = t.includes(".");
  if (hasComma && hasDot) {
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (hasComma) {
    t = t.replace(/,/g, "");
  }
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n);
}

export function normalizeImportedCustomerNumber(raw: string): string {
  return raw.replace(/\D/g, "").slice(-6);
}

export function parseImportClipboard(rawText: string): ParseResult {
  const lines = rawText.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], errors: [] };

  const grid = lines.map((l) => l.split("\t"));
  const headerFields = grid[0].map((h) => HEADER_MAP[normalizeHeaderCell(h)] ?? null);
  const hasHeader = headerFields.some((f) => f !== null);

  const fieldOrder: Array<FieldKey | null> = hasHeader ? headerFields : LEGACY_ORDER;
  const dataGrid = hasHeader ? grid.slice(1) : grid;

  const rows: ParsedRow[] = [];
  const errors: string[] = [];

  dataGrid.forEach((cells, i) => {
    const rowNo = hasHeader ? i + 2 : i + 1;
    const raw: Partial<Record<FieldKey, string>> = {};
    cells.forEach((cell, idx) => {
      const field = fieldOrder[idx];
      if (field) raw[field] = cell.trim();
    });

    const rawPhone = raw.phone || raw.whatsapp || "";
    // 客户编号不管输入的号码有多少位，只取数字部分的最后 6 位
    const phone = normalizeImportedCustomerNumber(rawPhone);
    if (!phone) {
      if (cells.some((c) => c.trim())) errors.push(`第 ${rowNo} 行：没有识别到客户编号，已跳过`);
      return;
    }

    const amount = normalizeAmount(raw.amountUsd ?? "");
    if (amount === "invalid") {
      errors.push(`第 ${rowNo} 行：客户金额不是有效数字，已跳过`);
      return;
    }

    rows.push({
      phone,
      name: raw.name ?? "",
      email: raw.email ?? "",
      amountUsd: amount,
      platform: raw.platform ?? "",
      note: raw.note ?? "",
    });
  });

  return { rows, errors };
}
