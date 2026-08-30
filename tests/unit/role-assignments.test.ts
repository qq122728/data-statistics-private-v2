import { describe, expect, it } from "vitest";
import { parseFrontlineSecondaryRoles } from "../../src/lib/role-assignments";

describe("一线兼任岗位校验", () => {
  it("允许一线账号同时增加另外两个岗位", () => {
    expect(parseFrontlineSecondaryRoles("RECEPTION", ["GROUP_OPERATOR", "EXPERT"])).toEqual({
      success: true,
      value: ["GROUP_OPERATOR", "EXPERT"],
    });
  });

  it("拒绝把主岗位本身或管理岗位设为兼任", () => {
    expect(parseFrontlineSecondaryRoles("RECEPTION", ["RECEPTION"])).toEqual({
      success: false,
      error: "兼任岗位只能选择主岗位以外的接粉、炒群或专家，且不能重复",
    });
    expect(parseFrontlineSecondaryRoles("GROUP_OPERATOR", ["ADMIN"])).toEqual({
      success: false,
      error: "兼任岗位只能选择主岗位以外的接粉、炒群或专家，且不能重复",
    });
  });
});
