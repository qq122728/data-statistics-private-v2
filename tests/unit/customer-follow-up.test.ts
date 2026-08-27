import { describe, expect, it } from "vitest";
import {
  customerStagnationDays,
  deriveCustomerFollowUpStage,
  isFollowUpPlanOverdue,
  suggestedCustomerNextPlan,
} from "../../src/lib/customer-follow-up";

const base = {
  invalid: false,
  groupStatus: "NOT_JOINED" as const,
  replyStatus: "NOT_REPLIED" as const,
  expertIntroducedOn: null,
  registeredOn: null,
  expertOwnerId: null,
  order: null,
};

describe("customer follow-up rules", () => {
  it("uses the furthest active funnel stage", () => {
    expect(deriveCustomerFollowUpStage(base)).toBe("NEW");
    expect(deriveCustomerFollowUpStage({ ...base, replyStatus: "REPLIED" })).toBe("REPLIED");
    expect(deriveCustomerFollowUpStage({ ...base, groupStatus: "JOINED" })).toBe("IN_GROUP");
    expect(deriveCustomerFollowUpStage({ ...base, groupStatus: "JOINED", expertIntroducedOn: "2026-08-10" })).toBe("WAITING_EXPERT_ASSIGNMENT");
    expect(deriveCustomerFollowUpStage({ ...base, groupStatus: "JOINED", expertIntroducedOn: "2026-08-10", expertOwnerId: "expert-1" })).toBe("EXPERT_INTRODUCED");
    expect(deriveCustomerFollowUpStage({ ...base, groupStatus: "JOINED", expertIntroducedOn: "2026-08-10", registeredOn: "2026-08-11" })).toBe("REGISTERED");
    expect(deriveCustomerFollowUpStage({ ...base, order: { voidedAt: null } })).toBe("ORDERED");
  });

  it("closes customers that are in the invalid library", () => {
    expect(deriveCustomerFollowUpStage({ ...base, invalid: true, order: { voidedAt: null } })).toBe("INVALID");
    expect(deriveCustomerFollowUpStage({ ...base, groupStatus: "LEFT", order: { voidedAt: null } })).toBe("LEFT_GROUP");
  });

  it("does not count a voided order as opened", () => {
    expect(deriveCustomerFollowUpStage({ ...base, registeredOn: "2026-08-11", order: { voidedAt: new Date() } })).toBe("REGISTERED");
  });

  it("calculates stagnation and overdue plans by calendar date", () => {
    expect(customerStagnationDays("2026-08-10", "2026-08-15")).toBe(5);
    expect(customerStagnationDays("2026-08-20", "2026-08-15")).toBe(0);
    expect(customerStagnationDays("bad", "2026-08-15")).toBeNull();
    expect(isFollowUpPlanOverdue("2026-08-14", "2026-08-15")).toBe(true);
    expect(isFollowUpPlanOverdue("2026-08-15", "2026-08-15")).toBe(false);
  });

  it("returns an actionable system plan", () => {
    expect(suggestedCustomerNextPlan("WAITING_EXPERT_ASSIGNMENT")).toContain("分配专家");
    expect(suggestedCustomerNextPlan("ORDERED")).toContain("续充");
  });
});
