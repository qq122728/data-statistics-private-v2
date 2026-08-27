import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpertPerformanceTable } from "../../src/components/lead/ExpertPerformanceTable";

(globalThis as { React?: typeof React }).React = React;

describe("expert performance table", () => {
  it("shows registration, order, deposit and pending metrics", () => {
    const html = renderToStaticMarkup(createElement(ExpertPerformanceTable, {
      experts: [{
        id: "expert-a",
        name: "专家甲",
        active: true,
        proxyLead: false,
        unassigned: false,
        handled: 10,
        registered: 6,
        ordered: 3,
        depositCents: 123450,
        cryptoDepositCents: 80000,
        bankDepositCents: 43450,
        unclassifiedDepositCents: 0,
        pendingRegistration: 4,
        pendingOrder: 3,
        pendingCustomers: [],
      }],
    }));

    expect(html).toContain("专家成员表现");
    expect(html).toContain("注册率按“已注册 ÷ 接手客户”");
    expect(html).toContain("开单率按“已开单 ÷ 已注册”");
    expect(html).toContain("60.0%");
    expect(html).toContain("50.0%");
    expect(html).toContain("$1,234.50");
  });
});
