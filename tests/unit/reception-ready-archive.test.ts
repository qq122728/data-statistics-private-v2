import { describe, expect, it } from "vitest";
import { customerWorkflowInputSchema } from "../../src/lib/customer-workflow/input";
import { buildBasicCustomerMutation } from "../../src/lib/customer-workflow/mutations";
import { roleAllowsCustomerAction } from "../../src/lib/customer-workflow/actions";

const baseLead = {
  invalid: false,
  deviceId: "device-1",
  repliedOn: "2026-08-25",
  followUpCount: 2,
  groupStatus: "NOT_JOINED" as const,
  joinedOn: null,
  expertIntroducedOn: null,
  expertContactedOn: null,
  registeredOn: null,
  customerOrder: null,
  receptionArchivedAt: null,
};

describe("reception ready-to-join and manual archive", () => {
  it("requires both archive reason and visit count", () => {
    expect(customerWorkflowInputSchema.safeParse({ action: "archiveRepliedCustomer" }).success).toBe(false);
    expect(customerWorkflowInputSchema.safeParse({ action: "archiveRepliedCustomer", reason: "拒绝进群" }).success).toBe(false);
    expect(customerWorkflowInputSchema.safeParse({ action: "archiveRepliedCustomer", reason: "拒绝进群", archiveVisitCount: 0 }).success).toBe(true);
    expect(customerWorkflowInputSchema.safeParse({ action: "archiveRepliedCustomer", reason: "拒绝进群", archiveVisitCount: 1.5 }).success).toBe(false);
  });

  it("keeps status and archive writes with the owning reception workflow", () => {
    expect(roleAllowsCustomerAction("RECEPTION", "updateReceptionChatStatus")).toBe(true);
    expect(roleAllowsCustomerAction("RECEPTION", "archiveRepliedCustomer")).toBe(true);
    expect(roleAllowsCustomerAction("RECEPTION", "restoreReceptionArchive")).toBe(true);
    expect(roleAllowsCustomerAction("GROUP_OPERATOR", "archiveRepliedCustomer")).toBe(false);
    expect(roleAllowsCustomerAction("EXPERT", "archiveRepliedCustomer")).toBe(false);
  });

  it("restores a manually archived customer without deleting the historical activity", () => {
    expect(buildBasicCustomerMutation({ action: "restoreReceptionArchive", reason: "客户重新回复" }, { ...baseLead, receptionArchivedAt: new Date("2026-08-26T12:00:00Z") }, "2026-08-27")).toMatchObject({
      update: { receptionArchivedAt: null, receptionArchiveReason: null, receptionArchiveVisitCount: null, receptionChatStatus: "NORMAL_CHAT" },
      activityKind: "RECEPTION_STATUS_UPDATED",
      activityNote: "从归档恢复继续跟进：客户重新回复",
    });
    expect(buildBasicCustomerMutation({ action: "restoreReceptionArchive" }, baseLead, "2026-08-27")).toMatchObject({ status: 400 });
  });

  it("stores ready status and rejects status changes before a reply", () => {
    expect(buildBasicCustomerMutation({ action: "updateReceptionChatStatus", receptionChatStatus: "READY_TO_JOIN" }, baseLead, "2026-08-26")).toMatchObject({
      update: { receptionChatStatus: "READY_TO_JOIN" },
      activityKind: "RECEPTION_STATUS_UPDATED",
    });
    expect(buildBasicCustomerMutation({ action: "updateReceptionChatStatus", receptionChatStatus: "READY_TO_JOIN" }, { ...baseLead, repliedOn: null }, "2026-08-26")).toMatchObject({ status: 400 });
  });

  it("archives only replied customers that have not entered a group", () => {
    expect(buildBasicCustomerMutation({ action: "archiveRepliedCustomer", reason: "多次沟通后拒绝", archiveVisitCount: 3 }, baseLead, "2026-08-26")).toMatchObject({
      update: { receptionArchiveReason: "多次沟通后拒绝", receptionArchiveVisitCount: 3 },
      activityKind: "RECEPTION_ARCHIVED",
    });
    expect(buildBasicCustomerMutation({ action: "archiveRepliedCustomer", reason: "拒绝", archiveVisitCount: 1 }, { ...baseLead, groupStatus: "JOINED" }, "2026-08-26")).toMatchObject({ status: 400 });
  });
});
