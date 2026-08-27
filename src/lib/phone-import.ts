import { normalizeCustomerPhone } from "./entry-ledger";

export type CustomerCodePrefix = "JH" | "TL" | "DL";

type PhoneImportOptions = {
  customerCodePrefix?: CustomerCodePrefix;
  channelName?: string;
};

export function customerCodePrefixForChannel(type: "SMS" | "ADS" | "REBATE"): CustomerCodePrefix {
  if (type === "ADS") return "TL";
  if (type === "REBATE") return "DL";
  return "JH";
}

export function buildCustomerCode(prefix: CustomerCodePrefix, channelName: string, suffix: string): string {
  const safeChannelName = channelName.trim().replace(/[\s-]+/g, "-").slice(0, 60) || "未命名渠道";
  return `${prefix}-${safeChannelName}-${suffix}`;
}

export function splitPhoneTokens(value: string): string[] {
  return value.split(/[\s,，;；]+/).map((phone) => phone.trim()).filter(Boolean);
}

export function parsePhoneImport(value: string, options: PhoneImportOptions = {}) {
  const rawPhones = splitPhoneTokens(value);
  const normalizedPhones: string[] = [];
  const invalidPhones: string[] = [];
  for (const phone of rawPhones) {
    try {
      if (/^\d{6}$/.test(phone) && options.customerCodePrefix && options.channelName) {
        normalizedPhones.push(buildCustomerCode(options.customerCodePrefix, options.channelName, phone));
      } else {
        normalizedPhones.push(normalizeCustomerPhone(phone));
      }
    } catch {
      invalidPhones.push(phone);
    }
  }
  const distinct = new Set<string>();
  const duplicatePhones = new Set<string>();
  for (const phone of normalizedPhones) {
    if (distinct.has(phone)) duplicatePhones.add(phone);
    distinct.add(phone);
  }
  return {
    rawPhones,
    invalidPhones,
    distinctPhones: [...distinct],
    duplicatePhones: [...duplicatePhones],
    duplicateCount: normalizedPhones.length - distinct.size,
  };
}
