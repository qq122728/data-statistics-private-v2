import { describe, expect, it } from "vitest";
import { parseFrontlineSecondaryRoles } from "../../src/lib/role-assignments";

describe("一线兼任岗位校验", () => {
  it("允许接粉主岗增加炒群兼任", () => {
    expect(parseFrontlineSecondaryRoles("RECEPTION", ["GROUP_OPERATOR"])).toEqual({
      success: true,
      value: ["GROUP_OPERATOR"],
    });
  });

  it("拒绝把专家或主岗位本身设为兼任", () => {
    expect(parseFrontlineSecondaryRoles("RECEPTION", ["EXPERT"])).toEqual({
      success: false,
      error: "接粉账号只能兼任前台炒群",
    });
    expect(parseFrontlineSecondaryRoles("GROUP_OPERATOR", ["GROUP_OPERATOR"])).toEqual({
      success: false,
      error: "炒群账号只能兼任前台接粉",
    });
  });
});
