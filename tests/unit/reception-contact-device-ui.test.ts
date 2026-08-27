import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EntryImportPanel, EntryReplyPanel } from "../../src/components/entry/EntryReceptionPanels";

const noop = vi.fn();
(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("reception contact device workflow", () => {
  it("keeps device selection out of number import and puts it beside the confirmation of contact", () => {
    const importMarkup = renderToStaticMarkup(createElement(EntryImportPanel, {
      channels: [{ id: "channel-a", name: "测试渠道", groupId: "group-a", channelType: "SMS" }],
      leads: [], sourceDate: "2026-08-20", channelId: "channel-a", newChannelName: "", newChannelType: "SMS", addingChannel: false,
      importRows: [{ id: "row-a", phone: "900001", customerName: "Allen", customerEmail: "allen@example.com", deviceMode: "SELECT", deviceId: "device-a", deviceCode: "", lossAmount: "50000", customerPlatform: "MT5", notes: "" }],
      devices: [{ id: "device-a", code: "W1" }], attributionOwners: [{ id: "operator-a", name: "欢喜" }, { id: "owner-a", name: "满贯" }], defaultAttributionOwnerId: "operator-a", allowMemberChannelCreation: true, busy: "", recognizedPhoneCount: 1,
      onSourceDate: noop, onChannelId: noop, onNewChannelName: noop, onNewChannelType: noop, onAddingChannel: noop, onImportRows: noop,
      onCreateChannel: noop, onConfirmImport: noop, onClearImportRows: noop, onAddImportRow: noop,
      batchSummaries: [], selectedBatchId: "", onViewBatch: noop, onCloseBatch: noop,
      context: () => null, notes: () => null, empty: (text: string) => text, actionDisabled: () => false, onAction: noop,
    }));
    const replyMarkup = renderToStaticMarkup(createElement(EntryReplyPanel, {
      leads: [{
        id: "lead-a", phone: "900001", invalid: false, replyStatus: "NOT_REPLIED", repliedOn: null, followUpCount: 0, lastFollowedUpOn: null,
        customerName: "Allen", customerEmail: null, lossAmountCents: 5_000_000, customerPlatform: "MT5", notes: null,
        groupStatus: "NOT_JOINED", joinedOn: null, leftOn: null, expertIntroducedOn: null, expertContactedOn: null, expertContactNote: null,
        expertWorkflowStage: null, expertStageChangedAt: null, expertTrackingStartedAt: null, registeredOn: null, expertNotes: null, nextPlan: null, nextFollowUpOn: null,
        receptionCategory: "VALID", invalidReason: null, groupOperatorOwner: null, expertOwner: null, owner: { receptionistAssignments: [] }, activities: [],
        device: null, batch: { id: "batch-a", sourceDate: "2026-08-20", fanCostModeSnapshot: "PAID", effectiveFanPriceCentsSnapshot: null, group: { name: "A组" }, channel: { id: "channel-a", name: "测试渠道" } }, customerOrder: null,
      }] as any,
      devices: [{ id: "device-a", code: "W1" }], deviceDrafts: {}, onDeviceDraft: noop, onDeviceSave: noop,
      onProfileFieldSave: noop,
      onViewProfile: noop, onDelete: noop, onVoidErroneousEntry: noop,
      context: () => null, notes: () => null, empty: (text: string) => text, actionDisabled: () => false, onAction: noop,
    }));

    expect(importMarkup).not.toContain("前台接粉设备号");
    expect(importMarkup).toContain("member-import-workspace");
    expect(importMarkup).toContain("member-import-redesign");
    expect(importMarkup).toContain("member-import-step");
    expect(importMarkup).toContain("member-import-methods");
    expect(importMarkup).toContain("member-import-source-card");
    expect(importMarkup).toContain("member-import-toolbar-note");
    expect(importMarkup).toContain("member-channel-picker-trigger");
    expect(importMarkup).toContain('aria-haspopup="listbox"');
    expect(importMarkup).toContain("member-channel-add-button");
    expect(importMarkup).toContain("从 Excel 粘贴");
    expect(importMarkup).toContain("上传 Excel 文件");
    expect(importMarkup).toContain('accept=".xlsx,.csv');
    expect(importMarkup).toContain("新增一行");
    expect(importMarkup).toContain("粉的归属");
    expect(importMarkup).toContain("粉的归属（默认）");
    expect(importMarkup).toContain('aria-label="默认粉的归属"');
    expect(importMarkup).toContain('aria-label="row-a 粉的归属"');
    expect(importMarkup).toContain("欢喜");
    expect(importMarkup).toContain("满贯");
    expect(importMarkup).toContain("实际录入人仍是当前登录账号");
    expect(replyMarkup).toContain("姓名");
    expect(replyMarkup).toContain("邮箱");
    expect(replyMarkup).toContain("金额");
    expect(replyMarkup).toContain("平台");
    expect(replyMarkup).toContain("客户情况");
    expect(replyMarkup).not.toContain("回访次数");
    expect(replyMarkup).toContain("member-reply-actions-cell");
    expect(replyMarkup).toContain("member-reply-table");
    expect(replyMarkup).toContain("member-reply-actions-layout");
    expect(replyMarkup).toContain("member-reply-compact-actions");
    expect(replyMarkup).toContain("member-reply-profile-quick");
    expect(replyMarkup).toContain("member-reply-profile-list");
    expect(replyMarkup.match(/data-profile-field=/g)).toHaveLength(5);
    expect(replyMarkup).toContain('data-profile-field="customerName"');
    expect(replyMarkup).toContain("未填");
    expect(replyMarkup).not.toContain("点击填写");
    expect(replyMarkup).toContain("member-reply-profile-actions");
    expect(replyMarkup).toContain("member-reply-processing-actions");
    expect(replyMarkup).toContain("接粉设备号");
    expect(replyMarkup).not.toContain("编辑资料");
    expect(replyMarkup).toContain("回访 0 +1");
    expect(replyMarkup).toContain("确认已回复");
    expect(replyMarkup).toContain("W1");
  });

  it("keeps the import workspace visible and opens new channel setup as a centered dialog", () => {
    const markup = renderToStaticMarkup(createElement(EntryImportPanel, {
      channels: [{ id: "channel-a", name: "测试渠道", groupId: "group-a", channelType: "SMS" }],
      leads: [], sourceDate: "2026-08-20", channelId: "channel-a", newChannelName: "美国短信 A", newChannelType: "SMS", addingChannel: true,
      importRows: [{ id: "row-a", phone: "900001", customerName: "", customerEmail: "", deviceMode: "SELECT", deviceId: "", deviceCode: "", lossAmount: "", customerPlatform: "", notes: "" }],
      devices: [], allowMemberChannelCreation: true, busy: "", recognizedPhoneCount: 1,
      onSourceDate: noop, onChannelId: noop, onNewChannelName: noop, onNewChannelType: noop, onAddingChannel: noop, onImportRows: noop,
      onCreateChannel: noop, onConfirmImport: noop, onClearImportRows: noop, onAddImportRow: noop,
      batchSummaries: [], selectedBatchId: "", onViewBatch: noop, onCloseBatch: noop,
      context: () => null, notes: () => null, empty: (text: string) => text, actionDisabled: () => false, onAction: noop,
    }));

    expect(markup).toContain('aria-label="新增来源渠道"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("member-channel-dialog-card");
    expect(markup).toContain("客户资料录入表");
  });
});
