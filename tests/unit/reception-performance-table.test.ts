import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReceptionPerformanceTable } from "../../src/components/lead/ReceptionPerformanceTable";

(globalThis as { React?: typeof React }).React = React;

describe("reception performance table", () => {
  it("shows only team and member summaries without customer phone numbers", () => {
    const html = renderToStaticMarkup(createElement(ReceptionPerformanceTable, {
      members: [{
        id: "member-a",
        name: "接粉甲",
        active: true,
        total: 12,
        invalid: 2,
        valid: 10,
        replied: 6,
        joined: 3,
        pendingReply: 4,
        pendingJoin: 3,
      }],
    }));

    expect(html).toContain("接粉明细");
    expect(html).toContain("本组汇总与人员对比；点击后续成员明细可再看每日变化，此页不展示客户电话号码。");
    expect(html).toContain("接粉人员");
    expect(html).toContain("添加数据");
    expect(html).toContain("60.0%");
    expect(html).toContain("50.0%");
    expect(html).toContain("回复 4 · 进群 3");
    expect(html).not.toContain("手机号");
    expect(html).not.toContain("查看客户");
  });
});
