import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "member-a", username: "member", name: "成员甲", passwordHash: "hash", role: "RECEPTION" as "ADMIN" | "LEAD" | "RECEPTION", active: true, groupId: "group-a" as string | null },
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
}));

vi.mock("../../src/lib/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireUser: vi.fn(async () => state.user),
}));

vi.mock("../../src/lib/db", () => ({
  db: {
    teamGroup: { findMany: vi.fn(async () => [{ id: "group-a", name: "一组", active: true }]) },
    user: { findMany: vi.fn(async () => []) },
    channel: { findMany: vi.fn(async () => []) },
    leadCustomer: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("../../src/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/settings")>("../../src/lib/settings");
  return {
    ...actual,
    getSystemSettings: vi.fn(async () => ({ appName: "数据统计", timezone: "Asia/Shanghai", defaultReportMode: "cumulative", allowMemberChannelCreation: true })),
  };
});

vi.mock("../../src/app/api/reports/route", () => ({
  GET: { buildReport: vi.fn(async () => ({ mode: "cumulative", rows: [] })) },
}));

import ReportsPage from "../../src/app/(app)/reports/page";

(globalThis as { React?: typeof React }).React = React;

describe("legacy report route migration", () => {
  beforeEach(() => {
    state.user = { id: "member-a", username: "member", name: "成员甲", passwordHash: "hash", role: "RECEPTION", active: true, groupId: "group-a" };
  });

  it("keeps the personal conversion report for a member", async () => {
    const page = await ReportsPage({ searchParams: Promise.resolve({ sourceDateFrom: "2026-08-01" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("我的业绩");
    expect(html).toContain('action="/reports"');
  });

  it.each(["ADMIN", "LEAD"] as const)("redirects %s from the legacy report to team performance", async (role) => {
    state.user = { ...state.user, role };

    await expect(ReportsPage({ searchParams: Promise.resolve({ sourceDateFrom: "2026-08-01" }) }))
      .rejects.toThrow("REDIRECT:/team-performance");
  });
});
