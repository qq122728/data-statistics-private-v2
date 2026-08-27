import { describe, expect, it } from "vitest";
import { isCorrectionAction, roleAllowsCustomerAction } from "../../src/lib/customer-workflow/actions";
import { buildBasicCustomerMutation } from "../../src/lib/customer-workflow/mutations";

const lead = {
  invalid: false,
  deviceId: null,
  repliedOn: null,
  followUpCount: 0,
  groupStatus: "NOT_JOINED" as const,
  joinedOn: null,
  expertIntroducedOn: null,
  expertContactedOn: null,
  registeredOn: null,
  customerOrder: null,
};

describe("reception number classification", () => {
  it("stores a valid classification", () => {
    expect(buildBasicCustomerMutation({ action: "classifyReception", receptionCategory: "VALID" }, lead, "2026-08-17")).toMatchObject({
      update: { receptionCategory: "VALID", invalid: false, invalidReason: null },
    });
  });

  it("removes the generic manual-invalid action and category", () => {
    expect(roleAllowsCustomerAction("RECEPTION", "markInvalid" as never)).toBe(false);
  });

  it("requires a low amount below 5000 dollars", () => {
    expect(buildBasicCustomerMutation({ action: "classifyReception", receptionCategory: "LOW_AMOUNT" }, lead, "2026-08-17")).toMatchObject({ status: 400 });
    expect(buildBasicCustomerMutation({ action: "classifyReception", receptionCategory: "LOW_AMOUNT", lossAmountCents: 500_000 }, lead, "2026-08-17")).toMatchObject({ status: 400 });
    expect(buildBasicCustomerMutation({ action: "classifyReception", receptionCategory: "LOW_AMOUNT", lossAmountCents: 499_999 }, lead, "2026-08-17")).toMatchObject({
      update: { receptionCategory: "LOW_AMOUNT", invalid: true, lossAmountCents: 499_999 },
    });
  });

  it("also automatically classifies a low amount when it is filled in later", () => {
    expect(buildBasicCustomerMutation({ action: "updateProfile", lossAmountCents: 499_999, customerPlatform: "MT5" }, lead, "2026-08-17")).toMatchObject({
      update: { receptionCategory: "LOW_AMOUNT", invalid: true, lossAmountCents: 499_999, customerPlatform: "MT5" },
    });
    expect(buildBasicCustomerMutation({ action: "updateProfile", lossAmountCents: 499_999 }, { ...lead, repliedOn: "2026-08-17" }, "2026-08-17")).toMatchObject({ status: 400 });
  });

  it("stores no-WS notes and removes the number from the funnel", () => {
    expect(buildBasicCustomerMutation({ action: "classifyReception", receptionCategory: "NO_WS", notes: "没有 WhatsApp" }, lead, "2026-08-17")).toMatchObject({
      update: { receptionCategory: "NO_WS", invalid: true, invalidReason: "无 WS 号码", notes: "没有 WhatsApp" },
    });
  });

  it("allows reply and group handoff from the invalid library, but blocks normal follow-up", () => {
    expect(buildBasicCustomerMutation({ action: "followUp" }, { ...lead, invalid: true, deviceId: "device-1" }, "2026-08-17")).toMatchObject({ status: 400 });
    expect(buildBasicCustomerMutation({ action: "reply" }, { ...lead, invalid: true, deviceId: "device-1" }, "2026-08-17")).toMatchObject({ update: { replyStatus: "REPLIED", repliedOn: "2026-08-17" } });
    expect(buildBasicCustomerMutation({ action: "joinGroup" }, { ...lead, invalid: true, repliedOn: "2026-08-17" }, "2026-08-17")).toMatchObject({ update: { groupStatus: "JOINED", joinedOn: "2026-08-17" } });
    expect(buildBasicCustomerMutation({ action: "introduceExpert" }, { ...lead, invalid: true, repliedOn: "2026-08-17", groupStatus: "JOINED" }, "2026-08-17")).toMatchObject({ status: 400 });
  });

  it("returns a replied customer to pending reply only before downstream handoff", () => {
    const repliedLead = { ...lead, deviceId: "device-1", repliedOn: "2026-08-17" };
    expect(buildBasicCustomerMutation({ action: "undoReply", reason: "误点" } as never, repliedLead, "2026-08-17")).toMatchObject({
      update: { replyStatus: "NOT_REPLIED", repliedOn: null },
      activityKind: "REPLY_UNDONE",
      activityNote: "撤销回复：误点",
    });
    expect(buildBasicCustomerMutation({ action: "undoReply", reason: "误点" } as never, { ...repliedLead, groupStatus: "JOINED" }, "2026-08-17")).toMatchObject({ status: 400 });
    expect(buildBasicCustomerMutation({ action: "undoReply", reason: "误点" } as never, { ...repliedLead, expertIntroducedOn: "2026-08-17" }, "2026-08-17")).toMatchObject({ status: 400 });
    expect(buildBasicCustomerMutation({ action: "undoReply", reason: "误点" } as never, { ...repliedLead, customerOrder: { voidedAt: null } }, "2026-08-17")).toMatchObject({ status: 400 });
  });

  it("treats undo reply as a correction so the API requires a reason and writes an audit record", () => {
    expect(isCorrectionAction("undoReply" as never)).toBe(true);
    expect(roleAllowsCustomerAction("RECEPTION", "undoReply" as never)).toBe(true);
  });

  it("does not allow a customer with downstream progress to be hidden as invalid", () => {
    expect(buildBasicCustomerMutation({ action: "classifyReception", receptionCategory: "NO_WS" }, { ...lead, repliedOn: "2026-08-17" }, "2026-08-17")).toMatchObject({ status: 400 });
  });
});
