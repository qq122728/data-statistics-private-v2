import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryGroupEvent } from "../../src/lib/history-groups";

const state = vi.hoisted(() => ({
  user: { id: "lead-a", username: "lead", name: "一组组长", passwordHash: "hash", role: "LEAD" as "ADMIN" | "LEAD" | "RECEPTION", active: true, groupId: "group-a" as string | null },
  events: [] as HistoryGroupEvent[],
  metricEventQueries: [] as Array<Record<string, unknown>>,
  customerOrderQueries: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  usePathname: () => "/history",
}));

vi.mock("../../src/lib/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireUser: vi.fn(async () => state.user),
}));

vi.mock("../../src/lib/db", () => ({
  db: {
    metricEvent: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.metricEventQueries.push({ where });
        const batch = (where.batch ?? {}) as { groupId?: string; sourceDate?: { gte?: string; lte?: string }; channel?: { normalizedName?: string } };
        return state.events.filter((event) =>
          (!where.enteredById || event.enteredBy.id === where.enteredById)
          && (!batch.groupId || event.batch.group.id === batch.groupId)
          && (!batch.sourceDate?.gte || event.batch.sourceDate >= batch.sourceDate.gte)
          && (!batch.sourceDate?.lte || event.batch.sourceDate <= batch.sourceDate.lte)
          && (!batch.channel?.normalizedName || event.batch.channel.normalizedName === batch.channel.normalizedName));
      }),
    },
    sourceBatch: { findMany: vi.fn(async () => []) },
    customerOrder: {
      findMany: vi.fn(async (query: Record<string, unknown>) => {
        state.customerOrderQueries.push(query);
        return [];
      }),
    },
    leadCustomer: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    systemSetting: { findMany: vi.fn(async () => []) },
  },
}));

import HistoryPage from "../../src/app/(app)/history/page";

(globalThis as { React?: typeof React }).React = React;

function event(overrides: Partial<HistoryGroupEvent> & { id: string }): HistoryGroupEvent {
  const { id, ...rest } = overrides;
  return {
    id,
    occurredOn: "2026-08-12",
    kind: "NEW_FANS",
    quantity: 1,
    amountCents: null,
    createdAt: new Date("2026-08-12T00:00:00Z"),
    batch: {
      id: `batch-${id}`,
      sourceDate: "2026-08-01",
      group: { id: "group-a", name: "一组", active: true },
      channel: { id: `channel-${id}`, name: "抖音", normalizedName: "抖音", active: true },
    },
    enteredBy: { id: "member-a", name: "成员甲", active: true },
    ...rest,
  } as HistoryGroupEvent;
}

describe("history analysis-link filters", () => {
  beforeEach(() => {
    state.user = { id: "lead-a", username: "lead", name: "一组组长", passwordHash: "hash", role: "LEAD", active: true, groupId: "group-a" };
    state.events = [
      event({ id: "matching" }),
      event({ id: "wrong-date", batch: { id: "batch-wrong-date", sourceDate: "2026-07-31", group: { id: "group-a", name: "一组", active: true }, channel: { id: "channel-wrong-date", name: "抖音", normalizedName: "抖音", active: true } } }),
      event({ id: "wrong-member", enteredBy: { id: "member-b", name: "成员乙", active: true } }),
      event({ id: "wrong-channel", batch: { id: "batch-wrong-channel", sourceDate: "2026-08-01", group: { id: "group-a", name: "一组", active: true }, channel: { id: "channel-wrong-channel", name: "快手", normalizedName: "快手", active: true } } }),
      event({ id: "forbidden-group", batch: { id: "batch-forbidden", sourceDate: "2026-08-01", group: { id: "group-b", name: "二组", active: true }, channel: { id: "channel-forbidden", name: "抖音", normalizedName: "抖音", active: true } } }),
    ];
    state.metricEventQueries = [];
    state.customerOrderQueries = [];
  });

  it("applies date, member, and normalized-channel filters without honoring a forged group", async () => {
    const page = await HistoryPage({
      searchParams: Promise.resolve({
        groupId: "group-b",
        sourceDateFrom: "2026-08-01",
        sourceDateTo: "2026-08-01",
        memberId: "member-a",
        normalizedName: " 抖音 ",
      }),
    });
    const html = renderToStaticMarkup(page);

    expect(state.metricEventQueries[0]).toMatchObject({
      where: {
        enteredById: "member-a",
        batch: {
          groupId: "group-a",
          sourceDate: { gte: "2026-08-01", lte: "2026-08-01" },
          channel: { normalizedName: "抖音" },
        },
      },
    });
    expect(html).toContain("接粉明细");
    expect(html).not.toContain("二组");
    expect(html).toContain('value="2026-08-01"');
    expect(html).toContain('action="/history"');
  });

  it("keeps a member's own history after the member moves to another group", async () => {
    state.user = { id: "member-a", username: "member-a", name: "成员甲", passwordHash: "hash", role: "RECEPTION", active: true, groupId: "group-b" };
    state.events = [event({ id: "old-group-own-event" })];

    const page = await HistoryPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-history-group-key="member-a::2026-08-12::batch-old-group-own-event"');
  });

  it("requests only active orders and active financial events for customer history", async () => {
    await HistoryPage({ searchParams: Promise.resolve({}) });

    expect(state.customerOrderQueries).toHaveLength(1);
    expect(state.customerOrderQueries[0]).toMatchObject({
      where: { voidedAt: null },
      select: {
        events: {
          where: {
            kind: { in: ["RECHARGE", "WITHDRAWAL"] },
            voidedAt: null,
          },
        },
      },
    });
    expect(state.metricEventQueries).toHaveLength(1);
    expect(state.metricEventQueries[0]).toMatchObject({
      where: { customerOrderId: null, voidedAt: null },
    });
  });
});
