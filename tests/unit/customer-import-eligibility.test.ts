import { describe, expect, it } from "vitest";
import { splitCustomerImportRows } from "../../src/lib/customer-import-eligibility";

describe("customer import eligibility", () => {
  it("keeps only customers that can enter the follow-up workflow", () => {
    const result = splitCustomerImportRows([
      { phone: "valid", lossAmountCents: 500_000 },
      { phone: "unknown-amount", lossAmountCents: null },
      { phone: "low", lossAmountCents: 499_999 },
    ]);
    expect(result.importable.map((row) => row.phone)).toEqual(["valid", "unknown-amount"]);
    expect(result.lowAmount.map((row) => row.phone)).toEqual(["low"]);
  });
});
