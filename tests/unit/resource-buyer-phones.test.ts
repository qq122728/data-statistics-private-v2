import { describe, expect, it } from "vitest";
import { buyerPhoneMetrics, cleanFullPhone, parseSheetData, phoneLines } from "../../src/lib/resource-buyer-phones";

describe("resource buyer phone attribution helpers", () => {
  it("keeps full numbers and removes only separators", () => {
    expect(cleanFullPhone("+65 9109-8668")).toBe("6591098668");
    expect(cleanFullPhone("91098668")).toBe("91098668");
    expect(cleanFullPhone("8668")).toBeNull();
  });

  it("deduplicates a batch and lists invalid values", () => {
    expect(phoneLines("号码\n91098668\n9109-8668\n96519961\nbad")).toEqual({
      phones: ["91098668", "96519961"], invalid: ["bad"], duplicates: 1, skippedHeaders: 1,
    });
  });

  it("recognizes ID headers, preserves country codes and deduplicates rows", () => {
    expect(phoneLines('ID\t代号\n+491755222287\t子龙\n+491755222287\t子龙\n3045468440\t子龙')).toEqual({
      phones: ["491755222287", "3045468440"], invalid: [], duplicates: 1, skippedHeaders: 1,
    });
    expect(phoneLines('\uFEFF"ID",代号\n"+49 1755-222287",子龙\nwrong,子龙')).toEqual({
      phones: ["491755222287"], invalid: ["wrong"], duplicates: 0, skippedHeaders: 1,
    });
    expect(phoneLines("491755222287\n3045468440").phones).toHaveLength(2);
  });

  it("reads conversion and money from the existing customer sheet", () => {
    const result = buyerPhoneMetrics({
      replied: true, joinedOn: "2026-10-04", expertOn: "2026-10-06", registeredOn: "2026-10-08",
      intakeOn: "2026-10-03", firstDepositOn: "2026-10-09", firstDeposit: 500,
      __investmentBaseCents: 0,
      __recharges: JSON.stringify([
        { id: "r", kind: "recharge", amountCents: 25000, date: "2026-10-10", method: "bank", actorId: "u", createdAt: "2026-10-10" },
        { id: "w", kind: "withdrawal", amountCents: 10000, date: "2026-10-11", method: "bank", actorId: "u", createdAt: "2026-10-11" },
      ]),
    });
    expect(result).toMatchObject({ replied: true, joined: true, expert: true, registered: true, opened: true, firstCents: 50000, rechargeCents: 25000, withdrawalCents: 10000, netCents: 65000, intakeOn: "2026-10-03", openedOn: "2026-10-09" });
  });

  it("does not use archived customer records", () => {
    expect(parseSheetData('{"channelId":"c","__deletedAt":"2026-10-11"}')).toBeNull();
    expect(parseSheetData("invalid-json")).toBeNull();
  });
});
