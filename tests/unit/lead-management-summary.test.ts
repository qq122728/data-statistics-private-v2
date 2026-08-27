import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeadManagementSummary } from "../../src/components/lead/LeadManagementSummary";
import { buildLeadManagementSummary, type LeadManagementInput } from "../../src/lib/lead-management-summary";

const standards = {
  receptionJoin: { pass: 10, good: 15, excellent: 20 },
  operatorExpert: { pass: 60, good: 70, excellent: 80 },
  expertOrder: { pass: 10, good: 15, excellent: 20 },
};

const base: LeadManagementInput = {
  sourceDate: "2026-08-10",
  repliedOn: null,
  joinedOn: null,
  groupStatus: "NOT_JOINED",
  expertIntroducedOn: null,
  expertContactedOn: null,
  expertOwnerId: null,
  registeredOn: null,
  hasTodayGroupProgress: false,
  hasActiveOrder: false,
  abnormalFinance: false,
};

describe("lead management summary without phone rows", () => {
  it("uses mature denominators and the agreed role grading standards", () => {
    const leads: LeadManagementInput[] = [
      ...Array.from({ length: 5 }, (_, index) => ({ ...base, joinedOn: "2026-08-14", groupStatus: "JOINED" as const, expertIntroducedOn: index < 3 ? "2026-08-15" : null, expertOwnerId: index < 3 ? "expert-a" : null })),
      ...Array.from({ length: 5 }, (_, index) => ({ ...base, joinedOn: index === 0 ? "2026-08-15" : null, expertIntroducedOn: "2026-08-15", expertOwnerId: "expert-a", hasActiveOrder: index === 0 })),
    ];
    const result = buildLeadManagementSummary(leads, "2026-08-16", standards);
    expect(result.cards.find((card) => card.key === "reception")).toMatchObject({ completed: 6, eligible: 10, grade: "EXCELLENT" });
    expect(result.cards.find((card) => card.key === "operator")).toMatchObject({ completed: 3, eligible: 5, rate: 60, grade: "PASS" });
    expect(result.cards.find((card) => card.key === "expert")).toMatchObject({ completed: 1, eligible: 8, grade: "PASS" });
  });

  it("builds a fixed process matrix with aggregate counts only", () => {
    const result = buildLeadManagementSummary([{ ...base, sourceDate: "2026-08-15" }], "2026-08-16", standards);
    expect(result.bottlenecks).toHaveLength(9);
    expect(result.bottlenecks.find((row) => row.key === "reply")).toMatchObject({ eligible: 1, completed: 0, overdue: 1, status: "WARNING" });
  });

  it("shows days past the deadline instead of total customer age", () => {
    const result = buildLeadManagementSummary([
      { ...base, expertIntroducedOn: "2026-08-10", expertOwnerId: "expert-a" },
      { ...base, expertIntroducedOn: "2026-08-10", expertOwnerId: "expert-a", expertContactedOn: "2026-08-10" },
      { ...base, expertIntroducedOn: "2026-08-10", expertOwnerId: "expert-a", expertContactedOn: "2026-08-10", registeredOn: "2026-08-10" },
    ], "2026-08-13", standards);
    expect(result.bottlenecks.find((row) => row.key === "contact")?.longestOverdueDays).toBe(2);
    expect(result.bottlenecks.find((row) => row.key === "register")?.longestOverdueDays).toBe(1);
    expect(result.bottlenecks.find((row) => row.key === "order")?.longestOverdueDays).toBe(1);
  });

  it("renders three grade cards and the matrix without customer-number columns", () => {
    const result = buildLeadManagementSummary([base], "2026-08-16", standards);
    const html = renderToStaticMarkup(createElement(LeadManagementSummary, { cards: result.cards, rows: result.bottlenecks }));
    expect(html).toContain("接粉岗");
    expect(html).toContain("炒群岗");
    expect(html).toContain("专家岗");
    expect(html).toContain("流程卡点矩阵");
    expect(html).not.toContain("手机号");
    expect(html).not.toContain("查看客户");
  });
});
