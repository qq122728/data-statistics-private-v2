import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { GroupCustomerTable, type GroupCustomer } from "../../src/components/lead/GroupCustomerTable";
import { GroupCustomerDataTable } from "../../src/components/lead/GroupCustomerDataTable";

(globalThis as { React?: typeof React }).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const base: GroupCustomer = {
  id: "lead-1",
  phone: "16469231521",
  customerName: "王",
  groupStatus: "JOINED",
  ownerName: "前台接粉 A",
  expertOwnerName: null,
  sourceDate: "2026-08-15",
  channelName: "短信粉",
  deviceCode: "W1",
  repliedOn: "2026-08-15",
  followUpCount: 1,
  lastFollowedUpOn: "2026-08-15",
  joinedOn: "2026-08-16",
  leftOn: null,
  leftWithOrder: false,
  expertIntroducedOn: null,
  expertContactedOn: null,
  expertContactNote: null,
  registeredOn: null,
  notes: null,
  groupProgress: [],
  order: null,
};

describe("group customer expert handoff UI", () => {
  it("shows the handoff work categories and an in-group assignment action", () => {
    const html = renderToStaticMarkup(createElement(GroupCustomerTable, {
      customers: [
        base,
        { ...base, id: "lead-2", phone: "13800138000", expertIntroducedOn: "2026-08-16", expertOwnerName: "专家 B" },
        { ...base, id: "lead-3", phone: "13700237000", expertIntroducedOn: "2026-08-15", expertOwnerName: "专家 A", expertContactedOn: "2026-08-15", groupProgress: [{ id: "progress-1", occurredOn: "2026-08-16", note: "客户在群内有互动", actorName: "炒群 A" }] },
      ],
      canEdit: true,
      currentDate: "2026-08-16",
      assignees: [{ id: "expert-b", name: "专家 B", role: "EXPERT", pendingRegistration: 2, pendingOrder: 1, deviceAccounts: [] }],
    }));

    expect(html).toContain("筛选专家阶段");
    for (const stage of ["排队中", "交资料", "追踪中", "待注册", "待开单", "不愿充", "已开单", "杀不动"]) expect(html).toContain(stage);
    expect(html).toContain("在群待推专家");
    expect(html).toContain("已推专家");
    expect(html).toContain("专家跟进");
    expect(html).toContain("推专家");
    expect(html).toContain("更多");
    expect(html).toContain("当前第 1 天");
    expect(html).toContain("填写炒群情况");
    expect(html).toContain("退群");
    expect(html).not.toContain("撤销已联系");
  });

  it("does not offer group operators a historical-customer entry", () => {
    const html = renderToStaticMarkup(createElement(GroupCustomerTable, {
      customers: [],
      canEdit: true,
      currentDate: "2026-08-21",
    }));

    expect(html).not.toContain("添加历史群客户");
    expect(html).not.toContain("历史群客户");
  });

  it("uses formal second-confirmation dialogs for group-operator state changes", async () => {
    const source = [
      await readFile(new URL("../../src/components/lead/GroupCustomerTable.tsx", import.meta.url), "utf8"),
      await readFile(new URL("../../src/components/lead/GroupCustomerDataTable.tsx", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).toContain("WorkflowConfirmationDialog");
    expect(source).toContain("TableActionMenu");
    expect(source).toContain("GroupProgressDialog");
    expect(source).toContain("NotePencil");
    expect(source).toContain("确认客户已经退群？");
    expect(source).toContain("确认撤销推专家？");
    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("window.confirm");
  });

  it("shows group and expert situations side by side for management when a customer has ordered", () => {
    const html = renderToStaticMarkup(createElement(GroupCustomerDataTable, {
      customers: [{
        ...base,
        id: "ordered-customer",
        isHistoricalRecord: true,
        groupProgress: [{ id: "progress-ordered", occurredOn: "2026-08-16", note: "群内完成交接后推给专家", actorName: "炒群 A" }],
        expertOwnerName: "专家 A",
        expertIntroducedOn: "2026-08-16",
        expertContactedOn: "2026-08-16",
        expertNotes: "已首充，今天继续沟通续充安排。",
        groupDeviceAccountNumber: "group-demo-001",
        expertDeviceAccountNumber: "expert-demo-001",
        order: { openedOn: "2026-08-16", initialDepositCents: 200_000, rechargeCents: 0, withdrawalCents: 0, voided: false },
      }],
      view: "ordered",
      canEdit: false,
      busy: "",
      today: "2026-08-16",
      onDetail: vi.fn(),
      onProgress: vi.fn(),
      onAssignment: vi.fn(),
      onContact: vi.fn(),
      onAction: vi.fn(),
    }));
    expect(html).toContain("炒群情况");
    expect(html).toContain("专家情况");
    expect(html).toContain("接粉情况");
    expect(html).toContain("群内完成交接后推给专家");
    expect(html).toContain("已首充，今天继续沟通续充安排。");
    expect(html).toContain("炒群号：group-demo-001");
    expect(html).toContain("专家号：expert-demo-001");
    expect(html).toContain("当前专家阶段");
    expect(html).toContain("历史补录");
  });

  it("offers the leave-group action on every active group-work tab", async () => {
    const source = await readFile(new URL("../../src/components/lead/GroupCustomerDataTable.tsx", import.meta.url), "utf8");
    expect(source).toContain('customer.groupStatus === "JOINED"');
    expect(source).toContain('onAction(customer, "leaveGroup")');
    expect((source.match(/\{leaveButton\}/g) ?? []).length).toBe(4);
  });

  it("provides separate number selectors for group and expert work", async () => {
    const source = [
      await readFile(new URL("../../src/components/lead/GroupProgressDialog.tsx", import.meta.url), "utf8"),
      await readFile(new URL("../../src/components/lead/ExpertCustomerEditors.tsx", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).toContain("本次炒群使用号码");
    expect(source).toContain("本次专家联系号码");
    expect(source).toContain("自己的炒群号码");
    expect(source).toContain("自己的专家号码");
  });
});
