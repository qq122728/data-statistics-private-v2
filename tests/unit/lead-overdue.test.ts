import { describe, expect, it } from "vitest";
import { buildLeadOverdueRows, classifyLeadOverdue, type LeadOverdueInput } from "../../src/lib/lead-overdue";

const base: LeadOverdueInput = {
  id: "lead-1",
  phone: "13800009999",
  customerName: "测试客户",
  sourceDate: "2026-08-10",
  channelName: "短信粉",
  groupStatus: "NOT_JOINED",
  repliedOn: null,
  joinedOn: null,
  expertIntroducedOn: null,
  expertContactedOn: null,
  registeredOn: null,
  nextPlan: null,
  nextFollowUpOn: null,
  hasActiveOrder: false,
  hasTodayGroupProgress: false,
  receptionName: "接粉 A",
  groupOperatorName: "炒群 A",
  expertName: "专家 A",
};

describe("lead overdue supervision", () => {
  it("flags a customer not replied after 24 hours", () => {
    expect(classifyLeadOverdue(base, "2026-08-11")).toMatchObject({ stage: "待回复", responsibleName: "接粉 A", overdueDays: 1 });
    expect(classifyLeadOverdue({ ...base, sourceDate: "2026-08-11" }, "2026-08-11")).toBeNull();
  });

  it("flags missing daily group progress with the operator", () => {
    expect(classifyLeadOverdue({ ...base, groupStatus: "JOINED", joinedOn: "2026-08-11" }, "2026-08-11")).toMatchObject({ stage: "群内进度未填", responsibleRole: "炒群岗", responsibleName: "炒群 A" });
    expect(classifyLeadOverdue({ ...base, groupStatus: "JOINED", joinedOn: "2026-08-11", hasTodayGroupProgress: true }, "2026-08-11")).toBeNull();
  });

  it("uses 24 and 48 hour thresholds for expert follow-up", () => {
    expect(classifyLeadOverdue({ ...base, groupStatus: "JOINED", expertIntroducedOn: "2026-08-10" }, "2026-08-11")).toMatchObject({ stage: "已推专家待联系", responsibleRole: "炒群岗", href: "/group-customers", overdueDays: 1 });
    expect(classifyLeadOverdue({ ...base, expertContactedOn: "2026-08-10" }, "2026-08-12")).toMatchObject({ stage: "待注册", overdueDays: 2 });
    expect(classifyLeadOverdue({ ...base, registeredOn: "2026-08-10" }, "2026-08-12")).toMatchObject({ stage: "待开单", overdueDays: 2 });
  });

  it("prioritizes an overdue explicit plan and excludes completed orders", () => {
    expect(classifyLeadOverdue({ ...base, nextPlan: "回访客户", nextFollowUpOn: "2026-08-10" }, "2026-08-12")).toMatchObject({ stage: "计划逾期", reason: "回访客户", priority: 0 });
    expect(classifyLeadOverdue({ ...base, hasActiveOrder: true }, "2026-08-12")).toBeNull();
  });

  it("sorts the most urgent stage first without duplicating customers", () => {
    const rows = buildLeadOverdueRows([
      base,
      { ...base, id: "lead-2", phone: "13800008888", nextFollowUpOn: "2026-08-10" },
    ], "2026-08-12");
    expect(rows.map((row) => row.id)).toEqual(["lead-2", "lead-1"]);
  });
});
