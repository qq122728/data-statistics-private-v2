import { describe, expect, it } from "vitest";
import { isWithinMaturityWindow } from "../../src/lib/analytics/maturity-window";

describe("maturity event windows", () => {
  it("includes the source and D7 boundary dates while excluding dates before and after", () => {
    expect(isWithinMaturityWindow("2026-08-01", "2026-07-31", 7)).toBe(false);
    expect(isWithinMaturityWindow("2026-08-01", "2026-08-01", 7)).toBe(true);
    expect(isWithinMaturityWindow("2026-08-01", "2026-08-08", 7)).toBe(true);
    expect(isWithinMaturityWindow("2026-08-01", "2026-08-09", 7)).toBe(false);
  });

  it("includes the D14 boundary and excludes the following day", () => {
    expect(isWithinMaturityWindow("2026-08-01", "2026-08-15", 14)).toBe(true);
    expect(isWithinMaturityWindow("2026-08-01", "2026-08-16", 14)).toBe(false);
  });
});
