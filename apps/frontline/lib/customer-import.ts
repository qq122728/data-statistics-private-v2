export type ImportRow = {
  id: string;
  phone: string;
  name: string;
  email: string;
  amountUsd: number | null;
  platform: string;
  status: "ok" | "dup" | "low" | "nows" | "incomplete";
};

export function formatCustomerNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 6) return digits;
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function formatUsd(usd: number | null): string {
  return usd === null ? "—" : `$${usd.toLocaleString("en-US")}`;
}
