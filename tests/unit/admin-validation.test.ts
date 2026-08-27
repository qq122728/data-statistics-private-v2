import { describe, expect, it } from "vitest";
import { getMemberProtectionError, isActiveLeadGroupConstraintError, isUniqueConstraintError, parseEffectiveFanPriceCents, parseEmploymentUpdate, parseRecruitmentUpdate } from "../../src/app/api/admin/users/validation";

describe("administrator lifecycle validation", () => {
  it("prevents an administrator from disabling their own account", () => {
    expect(getMemberProtectionError({
      actorId: "admin-1",
      targetId: "admin-1",
      currentRole: "ADMIN",
      currentActive: true,
      nextRole: "ADMIN",
      nextActive: false,
      activeAdminCount: 2,
    })).toBe("不能停用当前登录账号");
  });

  it("keeps the final active administrator active and in the administrator role", () => {
    expect(getMemberProtectionError({
      actorId: "admin-2",
      targetId: "admin-1",
      currentRole: "ADMIN",
      currentActive: true,
      nextRole: "RECEPTION",
      nextActive: true,
      activeAdminCount: 1,
    })).toBe("系统至少需要保留一个启用中的管理员");
  });

  it("recognizes Prisma unique conflicts without depending on an error class", () => {
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraintError(new Error("database unavailable"))).toBe(false);
  });

  it("distinguishes the one-active-lead database constraint from username conflicts", () => {
    expect(isActiveLeadGroupConstraintError({ code: "P2002", meta: { target: ["groupId"] } })).toBe(true);
    expect(isActiveLeadGroupConstraintError({ code: "P2002", meta: { target: ["username"] } })).toBe(false);
  });

  it.each([0, 5_000, 2_147_483_647])("accepts %i as integer cents", (value) => {
    expect(parseEffectiveFanPriceCents(value)).toEqual({ success: true, value });
  });

  it("accepts null to restore a channel to pending price", () => {
    expect(parseEffectiveFanPriceCents(null)).toEqual({ success: true, value: null });
  });

  it.each([-1, 1.5, 2_147_483_648, "5000"]) ("rejects an invalid integer-cent price: %s", (value) => {
    expect(parseEffectiveFanPriceCents(value)).toEqual({ success: false, error: "有效粉单价必须是 0 到 2147483647 之间的整数分" });
  });

  it("normalizes a valid employment update", () => {
    expect(parseEmploymentUpdate({ hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "  延长观察以补足样本  " })).toEqual({ success: true, value: { hireDate: "2026-08-01", stageOverride: "OBSERVATION", stageOverrideReason: "延长观察以补足样本" } });
  });

  it("clears a stale reason when clearing a stage override", () => {
    expect(parseEmploymentUpdate({ stageOverride: null, stageOverrideReason: "不应保留" })).toEqual({ success: true, value: { stageOverride: null, stageOverrideReason: null } });
  });

  it.each([[{ hireDate: "2026-02-29" }, "入职日期不正确"], [{ stageOverride: "UNKNOWN" }, "手动阶段不正确"], [{ stageOverride: "FORMAL", stageOverrideReason: "理由少" }, "手动阶段原因至少需要 4 个字"]])("rejects malformed employment input %#", (input, error) => {
    expect(parseEmploymentUpdate(input)).toEqual({ success: false, error });
  });

  it("normalizes company direct and agent referral records", () => {
    expect(parseRecruitmentUpdate({ recruitmentSource: "DIRECT", referrerName: "不应保留" })).toEqual({ success: true, value: { recruitmentSource: "DIRECT", referrerName: null } });
    expect(parseRecruitmentUpdate({ recruitmentSource: "AGENT", referrerName: "  阿德  " })).toEqual({ success: true, value: { recruitmentSource: "AGENT", referrerName: "阿德" } });
  });

  it("requires a referrer for agent referrals", () => {
    expect(parseRecruitmentUpdate({ recruitmentSource: "AGENT", referrerName: "" })).toEqual({ success: false, error: "代理介绍请填写介绍人" });
  });
});
