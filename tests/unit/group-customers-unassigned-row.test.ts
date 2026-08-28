import { describe, expect, it } from "vitest";
import { shouldShowUnassignedRow } from "../../src/app/(app)/group-customers/page";

describe("未分配炒群岗行的展示条件", () => {
  it("选中范围内零经手记录、但手里还有没退群老客户时仍要展示，不能只看 handled", () => {
    expect(shouldShowUnassignedRow({ handled: 0, inGroup: 1 })).toBe(true);
  });

  it("有经手记录时正常展示", () => {
    expect(shouldShowUnassignedRow({ handled: 3, inGroup: 0 })).toBe(true);
  });

  it("两者都是0才真的不展示", () => {
    expect(shouldShowUnassignedRow({ handled: 0, inGroup: 0 })).toBe(false);
  });

  it("summary 本身不存在也不展示", () => {
    expect(shouldShowUnassignedRow(undefined)).toBe(false);
  });
});
