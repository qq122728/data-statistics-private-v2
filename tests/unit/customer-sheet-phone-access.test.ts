import { describe, expect, it } from "vitest";
import { canViewFullSheetPhone } from "../../src/lib/customer-sheet-phone-access";

describe("客户进度表完整号码权限", () => {
  const actor = (role: "ADMIN" | "COMPANY_MANAGER" | "RECEPTION", duty: "HQ_MANAGER" | "COMPANY_MANAGER" | "DEPARTMENT_MANAGER" | null, groupId: string | null = null, active = true) => ({ role, duty, groupId, active });

  it("系统管理员和总公司管理员可跨组查看完整号码", () => {
    expect(canViewFullSheetPhone(actor("ADMIN", null), "other-group")).toBe(true);
    expect(canViewFullSheetPhone(actor("COMPANY_MANAGER", "HQ_MANAGER"), "other-group")).toBe(true);
  });

  it("本组账号保持原权限，其他管理账号和停用账号仍看不到完整号码", () => {
    expect(canViewFullSheetPhone(actor("RECEPTION", null, "own-group"), "own-group")).toBe(true);
    expect(canViewFullSheetPhone(actor("COMPANY_MANAGER", "COMPANY_MANAGER"), "other-group")).toBe(false);
    expect(canViewFullSheetPhone(actor("COMPANY_MANAGER", "DEPARTMENT_MANAGER"), "other-group")).toBe(false);
    expect(canViewFullSheetPhone(actor("RECEPTION", null, "another-group"), "other-group")).toBe(false);
    expect(canViewFullSheetPhone(actor("ADMIN", null, null, false), "other-group")).toBe(false);
  });
});
