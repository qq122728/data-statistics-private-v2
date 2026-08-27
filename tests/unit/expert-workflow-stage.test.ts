import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expertCustomerStage, trackingElapsedHours, trackingOverdue } from "../../src/components/lead/expert-customer-view";
import type { ExpertCustomer } from "../../src/components/lead/ExpertCustomerTable";

const trackingCustomer = (startedAt: Date | null) => ({
  expertWorkflowStage: "TRACKING",
  expertTrackingStartedAt: startedAt,
}) as ExpertCustomer;

describe("expert eight-stage workflow", () => {
  it("starts a pushed customer in the expert queue and warns at 48 tracking hours", () => {
    expect(expertCustomerStage({ expertWorkflowStage: "QUEUED" } as ExpertCustomer)).toBe("QUEUED");
    const now = Date.UTC(2026, 7, 19, 12, 0, 0);
    expect(trackingElapsedHours(trackingCustomer(new Date(now - 47 * 60 * 60 * 1000)), now)).toBe(47);
    expect(trackingOverdue(trackingCustomer(new Date(now - 47 * 60 * 60 * 1000)), now)).toBe(false);
    expect(trackingOverdue(trackingCustomer(new Date(now - 48 * 60 * 60 * 1000)), now)).toBe(true);
  });

  it("keeps the stage actions, default lead handoff, expert device binding and management-only complete rankings behind the intended rules", () => {
    const workflow = readFileSync("src/lib/customer-workflow/service.ts", "utf8");
    const dashboard = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
    const rankings = readFileSync("src/app/(app)/management-rankings/page.tsx", "utf8");
    for (const action of ["beginExpertReception", "beginExpertTracking", "markPendingRegistration"]) expect(workflow).toContain(action);
    expect(workflow).toContain('role: "LEAD"');
    expect(readFileSync("src/components/lead/ExpertAssignmentDialog.tsx", "utf8")).toContain("默认本组组长");
    expect(readFileSync("src/components/lead/ExpertAssignmentDialog.tsx", "utf8")).toContain("由专家本人填写实际使用的设备号");
    expect(workflow).toContain("expertDeviceAccountId");
    expect(workflow).toContain("只能使用自己名下的专家设备号");
    expect(readFileSync("src/app/api/customer-orders/route.ts", "utf8")).toContain('expertWorkflowStage: "ORDERED"');
    expect(dashboard).toContain("超过 48 小时");
    expect(rankings).toContain('user.role !== "ADMIN" && user.role !== "COMPANY_MANAGER"');
  });
});
