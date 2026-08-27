import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerOrderHistory } from "../../src/components/history/CustomerOrderHistory";

(globalThis as { React?: typeof React }).React = React;

const baseOrder = {
  openedOn: "2026-08-10",
  enteredBy: { name: "录入人" },
  batch: { sourceDate: "2026-08-01", channel: { name: "渠道" }, group: { name: "一组" } },
};

describe("customer order history", () => {
  it("hides voided orders and excludes voided financial events from details and totals", () => {
    const orders = [
      {
        ...baseOrder,
        id: "active-order",
        phone: "13800000001",
        initialDepositCents: 10_000,
        voidedAt: null,
        events: [
          { kind: "RECHARGE", amountCents: 2_000, occurredOn: "2026-08-11", continuationNumber: 1, voidedAt: null },
          { kind: "RECHARGE", amountCents: 9_000, occurredOn: "2026-08-12", continuationNumber: 2, voidedAt: new Date("2026-08-13") },
          { kind: "WITHDRAWAL", amountCents: 500, occurredOn: "2026-08-13", continuationNumber: null, voidedAt: null },
          { kind: "WITHDRAWAL", amountCents: 7_000, occurredOn: "2026-08-14", continuationNumber: null, voidedAt: new Date("2026-08-15") },
        ],
      },
      {
        ...baseOrder,
        id: "voided-order",
        phone: "13900000002",
        initialDepositCents: 88_800,
        voidedAt: new Date("2026-08-12"),
        events: [],
      },
    ];

    const html = renderToStaticMarkup(React.createElement(CustomerOrderHistory, { orders }));

    expect(html).toContain("共 1 个开单号码");
    expect(html).toContain("13800000001");
    expect(html).not.toContain("13900000002");
    expect(html).toContain("$115.00");
    expect(html).not.toContain("$90.00");
    expect(html).not.toContain("$70.00");
    expect(html).not.toContain("$888.00");
  });
});
