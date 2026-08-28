import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HighRiskConfirmationDialog } from "../../src/components/admin/HighRiskConfirmationDialog";
import { parseHighRiskReason } from "../../src/lib/high-risk-reason";
import {
  getMemberHighRiskOperation,
  requiresAdminPrivilegeConfirmation,
} from "../../src/components/admin/admin-high-risk";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("admin high-risk confirmation", () => {
  it("requires confirmation for new or promoted administrators only", () => {
    expect(requiresAdminPrivilegeConfirmation(null, "ADMIN")).toBe(true);
    expect(requiresAdminPrivilegeConfirmation("RECEPTION", "ADMIN")).toBe(true);
    expect(requiresAdminPrivilegeConfirmation("ADMIN", "ADMIN")).toBe(false);
    expect(requiresAdminPrivilegeConfirmation("RECEPTION", "LEAD")).toBe(false);
  });

  it("protects an existing administrator password reset using the original role", () => {
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "ADMIN", previousActive: true, nextActive: true, hasNewPassword: true }))
      .toBe("admin-password-reset");
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "LEAD", previousActive: true, nextActive: true, hasNewPassword: true }))
      .toBe("admin-access-revocation");
    expect(getMemberHighRiskOperation({ previousRole: "RECEPTION", nextRole: "RECEPTION", previousActive: true, nextActive: true, hasNewPassword: true })).toBeNull();
  });

  it("uses one administrator-grant confirmation when promotion also includes a password", () => {
    expect(getMemberHighRiskOperation({ previousRole: "RECEPTION", nextRole: "ADMIN", previousActive: true, nextActive: true, hasNewPassword: true }))
      .toBe("admin-privilege");
    expect(getMemberHighRiskOperation({ previousRole: null, nextRole: "ADMIN", previousActive: null, nextActive: true, hasNewPassword: true }))
      .toBe("admin-privilege");
  });

  it("protects every existing administrator access boundary", () => {
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "LEAD", previousActive: true, nextActive: true, hasNewPassword: false }))
      .toBe("admin-access-revocation");
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "ADMIN", previousActive: true, nextActive: false, hasNewPassword: false }))
      .toBe("admin-access-revocation");
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "ADMIN", previousActive: false, nextActive: true, hasNewPassword: false }))
      .toBe("admin-reactivation");
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "ADMIN", previousActive: false, nextActive: true, hasNewPassword: true }))
      .toBe("admin-reactivation");
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "LEAD", previousActive: false, nextActive: true, hasNewPassword: true }))
      .toBe("admin-access-revocation");
    expect(getMemberHighRiskOperation({ previousRole: "ADMIN", nextRole: "ADMIN", previousActive: true, nextActive: false, hasNewPassword: true }))
      .toBe("admin-access-revocation");
    expect(getMemberHighRiskOperation({ previousRole: "RECEPTION", nextRole: "RECEPTION", previousActive: true, nextActive: false, hasNewPassword: false })).toBeNull();
    expect(getMemberHighRiskOperation({ previousRole: "RECEPTION", nextRole: "RECEPTION", previousActive: false, nextActive: true, hasNewPassword: false })).toBeNull();
  });

  it("renders an accessible modal with reason and current-password requirements", () => {
    const markup = renderToStaticMarkup(React.createElement(HighRiskConfirmationDialog, {
      open: true,
      title: "确认授予管理员权限",
      description: "该成员将获得全系统管理权限。",
      confirmLabel: "确认授权",
      onClose: vi.fn(),
      onConfirm: vi.fn(async () => undefined),
    }));

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("确认授予管理员权限");
    expect(markup).toContain("该成员将获得全系统管理权限。");
    expect(markup).toContain("操作原因");
    expect(markup).toContain('name="highRiskReason"');
    expect(markup).toContain("当前管理员密码");
    expect(markup).toContain('name="currentPassword"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain("至少 4 个字");
    expect(markup).toContain('maxLength="500"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>确认授权<\/button>/);
  });

  it("uses the shared reason rule so zero-width characters cannot enable submission", () => {
    expect(parseHighRiskReason("\u200b\u200b\u200b\u200b"))
      .toEqual({ success: false, error: "请填写操作原因" });
    expect(parseHighRiskReason("调\u200b整!!"))
      .toEqual({ success: false, error: "操作原因至少需要 4 个字" });
    expect(parseHighRiskReason("  ＡＢ\u200b  Ｃ\nＤ  "))
      .toEqual({ success: true, value: "AB C D" });
  });
});
