import { describe, expect, it } from "vitest";
import { groupDayNumber } from "../../src/lib/group-progress";

describe("group customer day counter", () => {
  it("counts the join date as day one", () => {
    expect(groupDayNumber("2026-08-16", "2026-08-16")).toBe(1);
    expect(groupDayNumber("2026-08-16", "2026-08-17")).toBe(2);
    expect(groupDayNumber("2026-08-16", "2026-08-22")).toBe(7);
  });

  it("does not show a day before joining or without a join date", () => {
    expect(groupDayNumber(null, "2026-08-16")).toBeNull();
    expect(groupDayNumber("2026-08-17", "2026-08-16")).toBeNull();
  });
});
