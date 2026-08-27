import { describe, expect, it } from "vitest";
import { parseHighRiskReason } from "../../src/lib/high-risk-reason";

describe("high-risk reason normalization", () => {
  it("normalizes width, control characters, and repeated whitespace before storage", () => {
    expect(parseHighRiskReason("  ＡＢ\u200b  Ｃ\nＤ  ")).toEqual({ success: true, value: "AB C D" });
  });

  it.each([
    ["only zero-width format characters", "\u200b\u200b\u200b\u200b", "请填写操作原因"],
    ["controls cannot pad a short reason", "调\u0000整\u200b\u0007", "操作原因至少需要 4 个字"],
    ["punctuation does not count", "!!!!", "操作原因至少需要 4 个字"],
  ])("rejects %s", (_label, value, error) => {
    expect(parseHighRiskReason(value)).toEqual({ success: false, error });
  });

  it("counts Unicode code points for the 500-character maximum", () => {
    expect(parseHighRiskReason("调整原因" + "a".repeat(496))).toEqual(expect.objectContaining({ success: true }));
    expect(parseHighRiskReason("调整原因" + "a".repeat(497))).toEqual({ success: false, error: "操作原因不能超过 500 个字" });
  });
});
