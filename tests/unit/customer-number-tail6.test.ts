import { describe, expect, it } from "vitest";
import { customerNumberTail6, inspectCustomerNumberRows } from "../../scripts/normalize-customer-number-tail6-lib.mjs";

describe("customer number tail-6 migration", () => {
  it("removes non-digits and keeps the final six digits", () => {
    expect(customerNumberTail6("+49 160 813-3215")).toBe("133215");
    expect(customerNumberTail6("381002")).toBe("381002");
    expect(() => customerNumberTail6("12345")).toThrow("少于6位");
  });

  it("blocks a migration when different old numbers collapse to the same tail", () => {
    expect(inspectCustomerNumberRows([
      { id: "a", phone: "491608133215" },
      { id: "b", phone: "861608133215" },
      { id: "c", phone: "491715274343" },
    ])).toEqual({
      total: 3,
      invalidCount: 0,
      changedCount: 3,
      collisionGroupCount: 1,
      collisionCustomerCount: 2,
    });
  });
});
