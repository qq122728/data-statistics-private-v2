import { describe, expect, it } from "vitest";
import { isCalendarDate } from "../../src/lib/dates";
import { entryDateError } from "../../src/lib/entry-date-validation";

describe("entry date validation", () => {
  it("rejects dates that only look valid", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(entryDateError("2026-02-30", "2026-02-28", "业务日期")).toBe(
      "业务日期必须是实际存在的日期",
    );
  });

  it("rejects a future business date, but permits a past or current date", () => {
    expect(entryDateError("2026-08-19", "2026-08-18", "开单日期")).toBe(
      "开单日期不能晚于当前北京时间统计日",
    );
    expect(entryDateError("2026-08-18", "2026-08-18", "开单日期")).toBeNull();
    expect(entryDateError("2026-08-01", "2026-08-18", "开单日期")).toBeNull();
  });
});
