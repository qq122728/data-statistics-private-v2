import { describe, expect, it } from "vitest";
import { buildBasicCustomerMutation } from "../../src/lib/customer-workflow/mutations";
import type { CustomerWorkflowInput } from "../../src/lib/customer-workflow/input";

const lead = {
  invalid: false,
  deviceId: null,
  repliedOn: "2026-08-18",
  followUpCount: 0,
  groupStatus: "JOINED" as const,
  joinedOn: "2026-08-18",
  expertIntroducedOn: "2026-08-18",
  expertContactedOn: "2026-08-18",
  registeredOn: null,
  customerOrder: null,
};

const orderedLead = {
  ...lead,
  registeredOn: "2026-08-18",
  customerOrder: { voidedAt: null },
};

describe("专家杀不动", () => {
  it("必须选择原因，且其他原因必须填写说明", () => {
    const missing = buildBasicCustomerMutation({ action: "markExpertStalled" } as CustomerWorkflowInput, orderedLead, "2026-08-18");
    const other = buildBasicCustomerMutation({ action: "markExpertStalled", stalledReason: "OTHER" } as CustomerWorkflowInput, orderedLead, "2026-08-18");
    expect(missing).toMatchObject({ error: "请选择杀不动原因" });
    expect(other).toMatchObject({ error: "选择其他原因时请填写说明" });
  });

  it("保留原因和说明，恢复后清空状态而不删除客户", () => {
    const marked = buildBasicCustomerMutation({ action: "markExpertStalled", stalledReason: "NO_BUDGET", stalledNote: "下月再联系" } as CustomerWorkflowInput, orderedLead, "2026-08-18");
    const restored = buildBasicCustomerMutation({ action: "clearExpertStalled" } as CustomerWorkflowInput, { ...orderedLead, expertStalledOn: "2026-08-18" }, "2026-08-18");
    expect(marked).toMatchObject({ update: { expertStalledOn: "2026-08-18", expertStalledReason: "NO_BUDGET", expertStalledNote: "下月再联系" } });
    expect(restored).toMatchObject({ update: { expertStalledOn: null, expertStalledReason: null, expertStalledNote: null } });
  });

  it("没有开单不能标记杀不动；已注册未开单可标记不首充", () => {
    const blocked = buildBasicCustomerMutation({ action: "markExpertStalled", stalledReason: "NO_BUDGET" } as CustomerWorkflowInput, { ...lead, registeredOn: "2026-08-18" }, "2026-08-18");
    const marked = buildBasicCustomerMutation({ action: "markNoInitialDeposit", noInitialDepositReason: "NO_BUDGET", noInitialDepositNote: "暂时没有预算" } as CustomerWorkflowInput, { ...lead, registeredOn: "2026-08-18" }, "2026-08-18");
    const restored = buildBasicCustomerMutation({ action: "clearNoInitialDeposit" } as CustomerWorkflowInput, { ...lead, registeredOn: "2026-08-18", noInitialDepositOn: "2026-08-18" }, "2026-08-18");
    expect(blocked).toMatchObject({ error: "只有已开单客户才能标记杀不动" });
    expect(marked).toMatchObject({ update: { noInitialDepositOn: "2026-08-18", noInitialDepositReason: "NO_BUDGET", noInitialDepositNote: "暂时没有预算" } });
    expect(restored).toMatchObject({ update: { noInitialDepositOn: null, noInitialDepositReason: null, noInitialDepositNote: null } });
  });
});
