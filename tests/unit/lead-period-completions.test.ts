import { describe, expect, it } from "vitest";
import { countLeadPeriodCompletions, type LeadPeriodActivity } from "../../src/lib/lead-period-completions";

const current = {
  repliedOn: "2026-08-14",
  joinedOn: "2026-08-14",
  expertIntroducedOn: "2026-08-15",
  registeredOn: null,
};

describe("lead period completion counts", () => {
  it("counts customers instead of repeated actions after correction and re-entry", () => {
    const activities: LeadPeriodActivity[] = [
      ...Array.from({ length: 4 }, () => ({ leadId: "customer-a", kind: "EXPERT_INTRODUCED" as const, lead: current })),
      { leadId: "customer-b", kind: "EXPERT_INTRODUCED", lead: { ...current, expertIntroducedOn: "2026-08-16" } },
    ];

    expect(countLeadPeriodCompletions(activities).introduced).toBe(2);
  });

  it("does not count a completion that has been revoked in the current customer record", () => {
    const activities: LeadPeriodActivity[] = [
      { leadId: "customer-a", kind: "EXPERT_INTRODUCED", lead: { ...current, expertIntroducedOn: null } },
      { leadId: "customer-b", kind: "JOINED_GROUP", lead: { ...current, joinedOn: null } },
      { leadId: "customer-c", kind: "REPLIED", lead: current },
    ];

    expect(countLeadPeriodCompletions(activities)).toEqual({
      replied: 1,
      joined: 0,
      introduced: 0,
      registered: 0,
    });
  });
});
