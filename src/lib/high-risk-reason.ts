const unicodeControlOrFormat = /\p{C}+/gu;
const whitespace = /\s+/gu;
const unicodeLetterOrNumber = /[\p{L}\p{N}]/gu;

export type HighRiskReasonResult =
  | { success: true; value: string }
  | { success: false; error: string };

/** Normalize and validate the human-written justification stored in audit logs. */
export function parseHighRiskReason(input: unknown): HighRiskReasonResult {
  const value = typeof input === "string"
    ? input
      .normalize("NFKC")
      .replace(unicodeControlOrFormat, " ")
      .replace(whitespace, " ")
      .trim()
    : "";

  if (!value) return { success: false, error: "请填写操作原因" };
  if ([...value].length > 500) return { success: false, error: "操作原因不能超过 500 个字" };
  if ((value.match(unicodeLetterOrNumber) ?? []).length < 4) {
    return { success: false, error: "操作原因至少需要 4 个字" };
  }
  return { success: true, value };
}
