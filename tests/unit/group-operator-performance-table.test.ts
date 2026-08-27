import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupOperatorPerformanceTable } from "../../src/components/lead/GroupOperatorPerformanceTable";

(globalThis as { React?: typeof React }).React = React;

describe("group operator performance table", () => {
  it("shows handoff, introduction, churn and pending metrics", () => {
    const html = renderToStaticMarkup(createElement(GroupOperatorPerformanceTable, {
      operators: [{
        id: "operator-a",
        name: "炒群甲",
        active: true,
        unassigned: false,
        receptionNames: ["接粉甲"],
        handled: 10,
        inGroup: 8,
        introduced: 6,
        left: 2,
        earlyLeft: 1,
        watchLeft: 0,
        normalLeft: 1,
        unknownLeft: 0,
        leftWithOrder: 1,
        leftWithoutOrder: 1,
        pendingIntroduction: 2,
        firstDepositCents: 125000,
        pendingCustomers: [],
      }],
    }));

    expect(html).toContain("炒群成员表现");
    expect(html).toContain("1–8天退群为异常");
    expect(html).toContain("接粉甲");
    expect(html).toContain("60.0%");
    expect(html).toContain("待介绍");
    expect(html).toContain("异常 1");
    expect(html).toContain("已开单 1");
    expect(html).toContain("未开单 1");
    expect(html).toContain("首充（协作）");
    expect(html).toContain("$1,250.00");
  });
});
