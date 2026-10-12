import { investmentSummary } from "../../packages/customer-sheet/investment";
import type { SheetData } from "../../packages/customer-sheet/schema";

export function cleanFullPhone(raw: string): string | null {
  const phone = raw.trim().replace(/[\s()+-]/g, "");
  return /^\d{6,20}$/.test(phone) ? phone : null;
}

export function phoneLines(text: string): { phones: string[]; invalid: string[]; duplicates: number; skippedHeaders: number } {
  const phones: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let skippedHeaders = 0;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const value = line.trim().split(/[,，\t;]/)[0]?.replace(/^"|"$/g, "").trim() ?? "";
    if (!value) continue;
    // Some exports call the phone column ID; the label is not a customer number.
    if (/^(id|号码|客户号码|手机号码|手机号|电话号码|phone(?:[ _-]?number)?|mobile|tel)$/i.test(value)) { skippedHeaders++; continue; }
    const phone = cleanFullPhone(value);
    if (!phone) { invalid.push(value.slice(0, 60)); continue; }
    if (seen.has(phone)) { duplicates++; continue; }
    seen.add(phone);
    phones.push(phone);
  }
  return { phones, invalid, duplicates, skippedHeaders };
}

export function buyerPhoneMetrics(data: SheetData) {
  const amounts = investmentSummary(data);
  const opened = amounts.firstCents > 0;
  return {
    valid: !["撞粉", "低金额", "无 WS 号码", "人工无效"].includes(String(data.quality ?? "有效")),
    replied: data.replied === true || Boolean(data.repliedOn),
    joined: Boolean(data.joinedOn),
    expert: Boolean(data.expertOn || data.addedExpert || data.expertId),
    registered: Boolean(data.registeredOn),
    opened,
    firstCents: amounts.firstCents,
    rechargeCents: amounts.rechargeCents,
    withdrawalCents: amounts.withdrawalCents,
    legacyCents: amounts.baseCents,
    netCents: amounts.totalCents - amounts.withdrawalCents,
    intakeOn: String(data.intakeOn || ""),
    openedOn: String(data.firstDepositOn || data.orderedOn || ""),
  };
}

export function parseSheetData(raw: string): SheetData | null {
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) && !data.__deletedAt ? data as SheetData : null;
  } catch { return null; }
}
