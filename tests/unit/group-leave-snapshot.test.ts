import { describe, expect, it } from "vitest";
import { buildBasicCustomerMutation } from "../../src/lib/customer-workflow/mutations";

const base = {
  invalid: false,
  deviceId: null,
  repliedOn: "2026-08-01",
  followUpCount: 0,
  groupStatus: "JOINED" as const,
  joinedOn: "2026-08-01",
  expertIntroducedOn: null,
  expertContactedOn: null,
  registeredOn: null,
  customerOrder: null,
};

describe("退群时开单快照", () => {
  it("保存退群当时是否有有效开单", () => {
    expect(buildBasicCustomerMutation({ action: "leaveGroup" }, base, "2026-08-05")).toMatchObject({
      update: { groupStatus: "LEFT", leftOn: "2026-08-05", leftWithOrder: false },
    });
    expect(buildBasicCustomerMutation({ action: "leaveGroup" }, { ...base, customerOrder: { voidedAt: null } }, "2026-08-05")).toMatchObject({
      update: { leftWithOrder: true },
    });
    expect(buildBasicCustomerMutation({ action: "leaveGroup" }, { ...base, customerOrder: { voidedAt: new Date() } }, "2026-08-05")).toMatchObject({
      update: { leftWithOrder: false },
    });
  });

  it("将退群备注独立保存到客户记录和操作历史", () => {
    expect(buildBasicCustomerMutation({ action: "leaveGroup", leaveNote: "客户明确表示不再参与群内互动" }, base, "2026-08-05")).toMatchObject({
      update: { leftNote: "客户明确表示不再参与群内互动" },
      activityNote: "退群备注：客户明确表示不再参与群内互动",
    });
  });

  it("拒绝早于入群日期的退群，撤销退群时清空快照", () => {
    expect(buildBasicCustomerMutation({ action: "leaveGroup" }, base, "2026-07-31")).toMatchObject({ status: 400 });
    expect(buildBasicCustomerMutation({ action: "undoLeaveGroup" }, { ...base, groupStatus: "LEFT" }, "2026-08-06")).toMatchObject({
      update: { groupStatus: "JOINED", leftOn: null, leftWithOrder: null, leftNote: null },
    });
  });
});
