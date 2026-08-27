import { readFile } from "node:fs/promises";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
(globalThis as typeof globalThis & { React: typeof React }).React = React;

const readSource = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const readEntrySources = async () => (await Promise.all([
  readSource("src/components/entry/EntryTabs.tsx"),
  readSource("src/components/entry/EntryReceptionPanels.tsx"),
  readSource("src/components/entry/EntryCustomerTables.tsx"),
  readSource("src/components/entry/ReceptionDownstreamProgress.tsx"),
  readSource("src/components/entry/CustomerProfileDrawer.tsx"),
])).join("\n");

describe("member workflow entry layout", () => {
  it("renders the phone-first member workflow workspace", async () => {
    const { EntryTabs } = await import("../../src/components/entry/EntryTabs");
    const markup = renderToStaticMarkup(React.createElement(EntryTabs, {
      channels: [],
      batches: [],
      leads: [],
      timezone: "Asia/Shanghai",
      allowMemberChannelCreation: true,
    }));

    expect(markup).toContain("接粉工作台");
    expect(markup).toContain("号码导入");
    expect(markup).toContain("客户回复管理");
    expect(markup).toContain("客户进度");
    expect(markup).toContain("扣粉统计");
    expect(markup).toContain("无 WS");
    expect(markup).toContain("号码导入");
    expect(markup).not.toContain("待归类");
    expect(markup).not.toContain(">有效<");
    expect(markup).not.toContain(">专家与注册<");
    expect(markup).not.toContain(">转化开单<");
    expect(markup).not.toContain(">财务流水<");
  });

  it("uses the shared page shell and a compact table workflow", async () => {
    const [page, tabs] = await Promise.all([
      readSource("src/app/(app)/entry/page.tsx"),
      readEntrySources(),
    ]);

    expect(page).toContain('className="page-shell');
    expect(tabs).toContain("member-table");
    expect(tabs).toContain("member-import");
    expect(tabs).toContain("最近导入批次");
    expect(tabs).toContain("查看号码");
    expect(tabs).toContain("reception-pager-summary");
    expect(tabs).toContain("reception-pager-controls");
    expect(tabs).toContain('data-testid="entry-workspace"');
  });

  it("uses discrete follow-up actions instead of a reply-status dropdown", async () => {
    const tabs = await readEntrySources();
    for (const label of ["撞粉", "低金额", "无 WS 号码", "设备号", "回访 +1", "标记回复", "确认入群", "推专家", "确认开单"]) {
      expect(tabs).toContain(label);
    }
    expect(tabs).not.toContain("人工无效");
    expect(tabs).not.toContain("回复状态");
  });

  it("requires a visible second confirmation for state-changing reception actions", async () => {
    const tabs = await readEntrySources();
    expect(tabs).toContain("WorkflowConfirmationDialog");
    expect(tabs).toContain("TableActionMenu");
    for (const label of ["确认已回复", "确认回访 +1", "确认入群", "确认删除"]) {
      expect(tabs).toContain(label);
    }
    expect(tabs).toContain("requestLeadAction");
    expect(tabs).toContain("已回复，待入群");
    expect(tabs).toContain("requestDeleteLead");
    for (const icon of ["PhoneCall", "ChatCircleDots", "SignIn", "SignOut"]) expect(tabs).toContain(icon);
  });

  it("shows financial totals and a group/channel comparison", async () => {
    const sources = (await Promise.all([
      readSource("src/components/entry/EntryTabs.tsx"),
      readSource("src/components/entry/EntryFinancePanels.tsx"),
      readSource("src/components/entry/EntryOverview.tsx"),
    ])).join("\n");
    for (const label of ["当日添加数据", "当日低金额", "当日无 WS 号码", "当日有效数据", "当日进群", "当日退群", "当日介绍专家", "当日注册", "当日开单", "当日入金", "当日出金", "当日净业绩", "当月在群数据"]) expect(sources).toContain(label);
  });

  it("shows reception-owned downstream progress as a read-only, on-demand view", async () => {
    const sources = await readEntrySources();
    for (const label of ["客户后续进度", "炒群最新进度", "专家情况", "专家每日备注与进度", "每日记录"]) {
      expect(sources).toContain(label);
    }
    expect(sources).toContain("/downstream-progress");
  });

  it("keeps the full customer profile available from reply and progress work", async () => {
    const sources = await readEntrySources();

    expect(sources).toContain("查看资料");
    expect(sources).toContain("客户基本资料");
    expect(sources).toContain("客户邮箱");
    expect(sources).toContain("客户平台");
    expect(sources).toContain("前台接粉设备");
  });

  it("lets reception correct an untouched erroneous import from the invalid library", async () => {
    const { EntryInvalidLibrary } = await import("../../src/components/entry/EntryReceptionPanels");
    const invalidLead = {
      id: "invalid-import", phone: "13800009999", invalid: true, invalidReason: "低金额（低于 $5,000）", receptionCategory: "LOW_AMOUNT",
      replyStatus: "NOT_REPLIED", repliedOn: null, followUpCount: 0, lastFollowedUpOn: null, customerName: "误导入客户", lossAmountCents: 120_000, customerPlatform: "MT5",
      groupStatus: "NOT_JOINED", joinedOn: null, leftOn: null, expertIntroducedOn: null, expertContactedOn: null, expertContactNote: null,
      expertWorkflowStage: null, expertStageChangedAt: null, expertTrackingStartedAt: null, registeredOn: null, expertNotes: null, nextPlan: null, nextFollowUpOn: null, notes: null,
      groupOperatorOwner: null, expertOwner: null, owner: { receptionistAssignments: [] }, activities: [], device: null,
      batch: { id: "batch", sourceDate: "2026-08-20", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: null, group: { name: "A组" }, channel: { id: "channel", name: "投流粉" } },
      customerOrder: null,
    } as any;
    const markup = renderToStaticMarkup(React.createElement(EntryInvalidLibrary, {
      leads: [invalidLead], exceptions: [], category: "all", onCategory: vi.fn(), onRestore: vi.fn(),
      deviceDrafts: {}, onDeviceDraft: vi.fn(), onDeviceSave: vi.fn(), onAction: vi.fn(), actionDisabled: () => false, empty: (text: string) => text,
      onEditProfile: vi.fn(), onDelete: vi.fn(),
    }));

    expect(markup).toContain("编辑资料");
    expect(markup).toContain("删除错误导入");
  });
});
