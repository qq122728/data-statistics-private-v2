import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GroupCustomerDataTable } from "../../src/components/lead/GroupCustomerDataTable";
import type { GroupCustomer } from "../../src/components/lead/group-customer-types";

(globalThis as { React?: typeof React }).React = React;

const leftCustomer: GroupCustomer = {
  id: "left-1",
  phone: "16469231521",
  customerName: "测试客户",
  groupStatus: "LEFT",
  ownerName: "接粉甲",
  expertOwnerName: "专家甲",
  sourceDate: "2026-08-01",
  channelName: "短信粉",
  deviceCode: null,
  repliedOn: "2026-08-01",
  followUpCount: 1,
  lastFollowedUpOn: "2026-08-02",
  joinedOn: "2026-08-01",
  leftOn: "2026-08-05",
  leftWithOrder: false,
  leftNote: "客户主动退出，暂不考虑继续跟进。",
  expertIntroducedOn: "2026-08-03",
  expertContactedOn: "2026-08-04",
  expertContactNote: null,
  registeredOn: null,
  notes: null,
  groupProgress: [],
  order: null,
};

describe("退群客户标记", () => {
  it("在退群列表展示退群天数、风险和退群当时开单结果", () => {
    const html = renderToStaticMarkup(createElement(GroupCustomerDataTable, {
      customers: [leftCustomer],
      groupStatus: "LEFT",
      canEdit: false,
      busy: "",
      today: "2026-08-16",
      onDetail: vi.fn(),
      onProgress: vi.fn(),
      onAssignment: vi.fn(),
      onContact: vi.fn(),
      onAction: vi.fn(),
    }));
    expect(html).toContain("退群判断");
    expect(html).toContain("第 5 天 · 1–8天异常退群");
    expect(html).toContain("未开单退群");
    expect(html).toContain("退群备注");
    expect(html).toContain("客户主动退出，暂不考虑继续跟进。");
  });
});
