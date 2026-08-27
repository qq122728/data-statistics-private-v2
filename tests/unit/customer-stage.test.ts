import { describe, expect, it } from "vitest";
import { resolveCustomerStage } from "../../src/lib/customer-stage";

describe("shared customer stage", () => {
  it("uses one downstream-first precedence across all workspaces", () => {
    expect(resolveCustomerStage({ invalid: true, hasActiveOrder: true })).toBe("ORDERED");
    expect(resolveCustomerStage({ hasActiveOrder: true, registeredOn: "2026-08-10" })).toBe("ORDERED");
    expect(resolveCustomerStage({ registeredOn: "2026-08-10", expertContactedOn: "2026-08-09" })).toBe("REGISTERED");
    expect(resolveCustomerStage({ expertContactedOn: "2026-08-09", expertIntroducedOn: "2026-08-08" })).toBe("EXPERT_CONTACTED");
    expect(resolveCustomerStage({ expertIntroducedOn: "2026-08-08", groupStatus: "JOINED" })).toBe("EXPERT_INTRODUCED");
  });

  it("resolves the reception and group stages consistently", () => {
    expect(resolveCustomerStage({ groupStatus: "LEFT", repliedOn: "2026-08-01" })).toBe("LEFT_GROUP");
    expect(resolveCustomerStage({ groupStatus: "JOINED" })).toBe("IN_GROUP");
    expect(resolveCustomerStage({ repliedOn: "2026-08-01" })).toBe("REPLIED");
    expect(resolveCustomerStage({ followUpCount: 2 })).toBe("FOLLOW_UP");
    expect(resolveCustomerStage({})).toBe("NEW");
  });
});
