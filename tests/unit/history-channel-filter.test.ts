import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({ values: [] as unknown[] }));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T) => [hookState.values.length ? hookState.values.shift() as T : initial, vi.fn()] as const,
  };
});

import { EventHistoryTable } from "../../src/components/history/EventHistoryTable";
import { groupHistoryEvents, type HistoryGroupEvent } from "../../src/lib/history-groups";

Object.assign(globalThis, { React });

function historyEvent(overrides: Partial<HistoryGroupEvent> = {}): HistoryGroupEvent {
  return {
    id: "event-a",
    occurredOn: "2026-08-12",
    kind: "NEW_FANS",
    quantity: 111,
    amountCents: null,
    batch: {
      id: "batch-a",
      sourceDate: "2026-08-10",
      group: { id: "group-a", name: "一组", active: true },
      channel: { id: "channel-a", name: "底料", active: true },
    },
    enteredBy: { id: "member-a", name: "成员甲", active: true },
    ...overrides,
  };
}

const groupedMetricEvents: HistoryGroupEvent[] = [
  historyEvent(),
  historyEvent({ id: "event-b", kind: "REPLIES", quantity: 20 }),
  historyEvent({ id: "event-c", kind: "GROUP_JOIN", quantity: 15 }),
  historyEvent({ id: "event-d", kind: "GROUP_LEAVE", quantity: 2 }),
  historyEvent({ id: "event-e", kind: "EXPERT_INTRO", quantity: 9 }),
  historyEvent({ id: "event-f", kind: "REGISTRATION", quantity: 7 }),
  historyEvent({ id: "event-g", kind: "ORDER", quantity: 3 }),
];

const sharedChannelEvents: HistoryGroupEvent[] = [
  historyEvent({
    id: "shared-a",
    occurredOn: "2026-08-10",
    kind: "REPLIES",
    quantity: 1,
    batch: {
      id: "batch-shared-a",
      sourceDate: "2026-08-09",
      group: { id: "group-a", name: "一组", active: true },
      channel: { id: "shared-channel", name: "同名渠道", active: true },
    },
  }),
  historyEvent({
    id: "shared-b",
    occurredOn: "2026-08-10",
    kind: "REPLIES",
    quantity: 2,
    batch: {
      id: "batch-shared-b",
      sourceDate: "2026-08-09",
      group: { id: "group-b", name: "二组", active: true },
      channel: { id: "shared-channel", name: "同名渠道", active: true },
    },
    enteredBy: { id: "member-b", name: "成员乙", active: true },
  }),
];

function renderHistory(events: HistoryGroupEvent[], currentUser: { id: string; role: "ADMIN" | "LEAD" | "RECEPTION" }) {
  return renderToStaticMarkup(React.createElement(
    EventHistoryTable as React.ComponentType<Record<string, unknown>>,
    { groups: groupHistoryEvents(events), currentUser, batches: [] },
  ));
}

describe("grouped history display", () => {
  beforeEach(() => { hookState.values = []; });

  it("consolidates one batch's metric events into one dated record", () => {
    const markup = renderHistory(groupedMetricEvents, { id: "member-a", role: "RECEPTION" });
    const records = markup.match(/data-testid="history-group-row"/g) ?? [];

    expect(markup).toContain("共 1 条");
    expect(markup).toContain("2026-08-12");
    expect(markup).toContain("添加数据");
    expect(markup).toContain("111");
    expect(markup).toContain("回复");
    expect(markup).toContain("20");
    const recordMarkup = markup.match(/<article[^>]*data-testid="history-group-row"[\s\S]*?<\/article>/)?.[0] ?? "";
    expect(recordMarkup.match(/底料 · 一组/g)).toHaveLength(1);
    expect(records).toHaveLength(1);
  });

  it("hides the member selector from members and shows it to leads", () => {
    const memberMarkup = renderHistory(groupedMetricEvents, { id: "member-a", role: "RECEPTION" });
    const leadMarkup = renderHistory(groupedMetricEvents, { id: "lead-a", role: "LEAD" });

    expect(memberMarkup).not.toContain('aria-label="成员"');
    expect(leadMarkup).toContain('aria-label="成员"');
  });

  it("offers editing only on the current user's own record", () => {
    const markup = renderHistory(sharedChannelEvents, { id: "member-a", role: "LEAD" });

    expect(markup.match(/>编辑<\/button>/g)).toHaveLength(1);
    expect(markup.match(/>查看详情<\/button>/g)).toHaveLength(1);
  });

});

describe("history channel filtering", () => {
  beforeEach(() => { hookState.values = []; });

  it("renders same-id channels from different groups as distinct filter options", () => {
    const markup = renderHistory(sharedChannelEvents, { id: "lead-a", role: "LEAD" });

    expect(markup).toContain('<option value="group-a:shared-channel">同名渠道 · 一组</option>');
    expect(markup).toContain('<option value="group-b:shared-channel">同名渠道 · 二组</option>');
  });

  it("filters a shared channel id to the selected group only", () => {
    hookState.values = ["", "", "group-a:shared-channel", ""];

    const markup = renderHistory(sharedChannelEvents, { id: "lead-a", role: "LEAD" });
    const records = markup.match(/data-testid="history-group-row"/g) ?? [];

    expect(markup).toContain('data-history-group-key="member-a::2026-08-10::batch-shared-a"');
    expect(markup).not.toContain('data-history-group-key="member-b::2026-08-10::batch-shared-b"');
    expect(records).toHaveLength(1);
  });
});
