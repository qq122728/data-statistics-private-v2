import { describe, expect, it } from "vitest";
import { statisticsDate } from "../../src/lib/statistics-date";

describe("statisticsDate", () => {
  it("uses the China calendar date before 14:00", () => {
    expect(statisticsDate(new Date("2026-08-31T05:59:59.000Z"))).toBe("2026-08-31");
  });

  it("switches to the next statistical date at China 14:00", () => {
    expect(statisticsDate(new Date("2026-08-31T06:00:00.000Z"))).toBe("2026-09-01");
  });

  it("keeps the next date until the following China 14:00", () => {
    expect(statisticsDate(new Date("2026-09-01T05:59:59.000Z"))).toBe("2026-09-01");
    expect(statisticsDate(new Date("2026-09-01T06:00:00.000Z"))).toBe("2026-09-02");
  });
});
