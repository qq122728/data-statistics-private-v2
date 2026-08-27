import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoleTaskDashboard } from "../../src/components/dashboard/RoleTaskDashboard";

(globalThis as { React?: typeof React }).React = React;

describe("role task dashboard", () => {
  it("renders compact task counts and customer details for a frontline role", () => {
    const html = renderToStaticMarkup(createElement(RoleTaskDashboard, {
      title: "专家今日待办",
      description: "只显示分配给你的客户",
      emptyMessage: "没有待办",
      queues: [
        {
          key: "register",
          label: "待注册",
          description: "等待完成注册",
          href: "/expert-customers",
          tone: "amber" as const,
          rows: [{ id: "lead-1", phone: "13800138000", customerName: "客户甲", ownerName: "接粉 A", source: "2026-08-15 · 渠道甲", status: "明天继续跟进", lastAction: "介绍 2026-08-15" }],
        },
      ],
    }));

    expect(html).toContain("专家今日待办");
    expect(html).toContain("待注册");
    expect(html).toContain("138****8000");
    expect(html).not.toContain("13800138000");
    expect(html).toContain("接粉 A");
    expect(html).toContain('href="/expert-customers"');
  });
});
