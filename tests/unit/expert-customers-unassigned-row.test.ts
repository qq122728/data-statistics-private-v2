import { describe, expect, it } from "vitest";
import { shouldShowUnassignedExpertRow } from "../../src/app/(app)/expert-customers/page";

describe("未分配专家行的展示条件", () => {
  it("handled 记成0，但仍有待注册/待开单的真实待办时仍要展示，不能只看 handled", () => {
    expect(shouldShowUnassignedExpertRow({ handled: 0, registered: 0, ordered: 0, pendingRegistration: 0, pendingOrder: 1 })).toBe(true);
    expect(shouldShowUnassignedExpertRow({ handled: 0, registered: 0, ordered: 0, pendingRegistration: 1, pendingOrder: 0 })).toBe(true);
  });

  it("有经手记录时正常展示", () => {
    expect(shouldShowUnassignedExpertRow({ handled: 2, registered: 0, ordered: 0, pendingRegistration: 0, pendingOrder: 0 })).toBe(true);
  });

  it("全部字段都是0才真的不展示", () => {
    expect(shouldShowUnassignedExpertRow({ handled: 0, registered: 0, ordered: 0, pendingRegistration: 0, pendingOrder: 0 })).toBe(false);
  });
});
