import { describe, expect, it } from "vitest";
import { localDateFilterBounds, localDateYYYYMMDD } from "../../src/lib/dates";

describe("localDateYYYYMMDD", () => {
  it("keeps the Los Angeles calendar date before local midnight at a UTC boundary", () => {
    expect(localDateYYYYMMDD(new Date("2026-08-11T06:30:00.000Z"), "America/Los_Angeles")).toBe("2026-08-10");
  });
});

describe("localDateFilterBounds", () => {
  it("turns Los Angeles calendar dates into their UTC query boundaries", () => {
    const bounds = localDateFilterBounds("2026-08-11", "2026-08-11", "America/Los_Angeles");
    expect(bounds.gte?.toISOString()).toBe("2026-08-11T07:00:00.000Z");
    expect(bounds.lt?.toISOString()).toBe("2026-08-12T07:00:00.000Z");
  });

  it("uses the configured timezone across a daylight-saving boundary", () => {
    const bounds = localDateFilterBounds("2026-11-01", "2026-11-01", "America/Los_Angeles");
    expect(bounds.gte?.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(bounds.lt?.toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });
});
