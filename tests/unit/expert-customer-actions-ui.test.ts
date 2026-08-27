import * as React from "react";
import { createElement } from "react";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExpertCustomerTable, type ExpertCustomer } from "../../src/components/lead/ExpertCustomerTable";
import { HistoricalExpertCustomerDialog } from "../../src/components/lead/HistoricalExpertCustomerDialog";

(globalThis as { React?: typeof React }).React = React;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const base: ExpertCustomer = {
  id: "expert-lead-1",
  batchId: "batch-1",
  phone: "13800138000",
  customerName: "客户 A",
  ownerName: "前台接粉 A",
  expertOwnerId: "expert-1",
  expertOwnerName: "专家 A",
  isHistoricalRecord: true,
  source: "2026-08-16 · 短信粉",
  repliedOn: "2026-08-15",
  followUpCount: 2,
  lastFollowedUpOn: "2026-08-16",
  expertIntroducedOn: "2026-08-16",
  expertContactedOn: null,
  expertContactNote: null,
  expertWorkflowStage: "QUEUED",
  registeredOn: null,
  notes: null,
  nextPlan: null,
  nextFollowUpOn: null,
  groupProgress: [{ id: "group-progress-1", occurredOn: "2026-08-16", note: "群内已经完成交接", actorName: "炒群 A" }],
  lastActivity: null,
  order: null,
};

describe("expert customer row actions", () => {
  it("uses icon-and-text primary actions plus a compact more menu", () => {
    const html = renderToStaticMarkup(createElement(ExpertCustomerTable, {
      customers: [
        base,
        { ...base, id: "expert-lead-2", phone: "13800138001", registeredOn: "2026-08-16" },
        { ...base, id: "expert-lead-3", phone: "13800138002", registeredOn: "2026-08-16", order: { id: "order-1", openedOn: "2026-08-16", initialDepositCents: 10_000, voided: false, rechargeCents: 0, withdrawalCents: 0, latestFinancialOn: null, events: [] } },
      ],
      today: "2026-08-16",
      canEdit: true,
    }));

    expect(html).toContain("开始接待");
    expect(html).toContain("待开单");
    expect(html).toContain("炒群情况");
    expect(html).toContain("接粉情况");
    expect(html).toContain("历史来源：2026-08-16 · 短信粉");
    expect(html).toContain("群内已经完成交接");
    expect(html).toContain("历史补录");
    expect((html.match(/历史补录/g) ?? [])).toHaveLength(3);
    expect(html).not.toContain("标记已联系");
    expect(html).toContain("<svg");
  });

  it("offers experts a separate historical customer import entry", () => {
    const html = renderToStaticMarkup(createElement(ExpertCustomerTable, {
      customers: [], today: "2026-08-16", canEdit: true, canAddHistorical: true,
      historicalImportOptions: {
        members: [{ id: "expert-a", name: "专家 A", active: true, roleLabel: "专家" }],
        channels: [{ id: "channel-a", name: "FB 投流", active: true, channelType: "ADS" }],
        currentUserId: "expert-a",
        entryRole: "EXPERT",
      },
    }));
    expect(html).toContain("录入老客户");
    expect(html).toContain("启用前阶段不重复计数");
  });

  it("lets historical expert imports select an existing channel or enter a manual source", () => {
    const html = renderToStaticMarkup(createElement(HistoricalExpertCustomerDialog, {
      open: true,
      today: "2026-08-16",
      busy: false,
      error: "",
      canChooseExpert: true,
      receptionOwners: [{ id: "reception-a", name: "前台接粉 A" }, { id: "expert-a", name: "专家 A" }],
      groupOperators: [{ id: "operator-a", name: "前台炒群 A" }, { id: "reception-a", name: "前台接粉 A" }],
      expertOwners: [{ id: "expert-a", name: "专家 A", label: "专家 A" }],
      sourceChannels: [{ id: "channel-a", name: "FB 投流" }],
      defaultExpertOwnerId: "expert-a",
      onClose: vi.fn(),
      onSubmit: vi.fn(),
    }));
    expect(html).toContain("选择已有渠道");
    expect(html).toContain("手动填写");
    expect(html).toContain("FB 投流");
    expect(html).toContain("历史接粉归属");
    expect(html).toContain("历史炒群归属");
    expect(html).toContain("可选择本组全部成员");
    expect(html).toContain("专家 A");
  });

  it("uses formal correction dialogs instead of browser prompts", async () => {
    const source = [
      await readFile(new URL("../../src/components/lead/ExpertCustomerTable.tsx", import.meta.url), "utf8"),
      await readFile(new URL("../../src/components/lead/ExpertCustomerDataTable.tsx", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).toContain("TableActionMenu");
    expect(source).toContain("WorkflowConfirmationDialog");
    expect(source).toContain("确认客户已经完成注册？");
    expect(source).toContain("确认登记客户开单？");
    expect(source).toContain("确认撤销客户注册？");
    expect(source).toContain("确认作废这笔资金流水？");
    expect(source).not.toContain("window.prompt");
    expect(source).not.toContain("window.confirm");
  });

  it("asks for actual dates when an expert confirms each workflow stage", async () => {
    const source = [
      await readFile(new URL("../../src/components/lead/ExpertCustomerTable.tsx", import.meta.url), "utf8"),
      await readFile(new URL("../../src/components/ui/WorkflowConfirmationDialog.tsx", import.meta.url), "utf8"),
    ].join("\n");
    expect(source).toContain("实际开始接待日期");
    expect(source).toContain("实际交资料／开始追踪日期");
    expect(source).toContain("实际转待注册日期");
    expect(source).toContain("实际注册日期");
    expect(source).toContain("确认历史补录客户已交资料？");
    expect(source).toContain("确认历史补录客户转为待注册？");
    expect(source).toContain("确认历史补录客户已经完成注册？");
    expect(source).toContain("确认登记历史补录客户开单？");
    expect(source).toContain('type="date"');
    expect(source).toContain("minDate");
  });
});
