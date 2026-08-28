import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditLogTable } from "../../src/components/admin/AuditLogTable";
import {
  ChannelTable,
  formatChannelGroupLabel,
  type ManagedChannel,
} from "../../src/components/admin/ChannelTable";
import { adminRoleOptions } from "../../src/components/admin/MemberTable";
import {
  adminMutationSuccessMessage,
  classifyAdminFormError,
  formatAuditSummary,
  formatAuditTarget,
  formatAuditTime,
  formatEffectiveFanPrice,
  requestAdminMutation,
} from "../../src/components/admin/admin-display";

describe("admin mutation feedback", () => {
  it("offers every current frontline role in admin account management", () => {
    expect(adminRoleOptions).toEqual([
      { value: "RECEPTION", label: "前台接粉" },
      { value: "GROUP_OPERATOR", label: "前台炒群" },
      { value: "EXPERT", label: "前台专家" },
      { value: "LEAD", label: "组长" },
      { value: "RESOURCE_MANAGER", label: "资源部管理员（按短信／投流类型）" },
      { value: "COMPANY_MANAGER", label: "公司管理员（仅本公司）" },
      { value: "FINANCE", label: "财务（考勤与业绩导出）" },
      { value: "HR", label: "行政（仅人员档案与考勤）" },
      { value: "ADMIN", label: "管理员" },
    ]);
  });

  it("describes member reset and channel reactivation in plain Chinese", () => {
    expect(adminMutationSuccessMessage("member", "reset", "王小明")).toBe("已重置成员“王小明”的密码");
    expect(adminMutationSuccessMessage("channel", "enable", "抖音广告")).toBe("已重新启用渠道“抖音广告”");
  });

  it("turns a network failure into a useful Chinese error", async () => {
    const failingFetch = async () => { throw new TypeError("Failed to fetch"); };
    await expect(requestAdminMutation("/api/admin/users", {}, "POST", failingFetch as typeof fetch))
      .rejects.toThrow("网络异常，请检查连接后重试");
  });

  it.each([
    ["member", "登录账号已存在", "username"],
    ["member", "成员姓名不能为空", "name"],
    ["member", "临时密码至少需要 12 位", "password"],
    ["member", "角色不正确", "role"],
    ["member", "成员和组长必须选择启用中的小组", "groupId"],
    ["group", "已有同名小组", "name"],
    ["channel", "该小组已有同名渠道", "name"],
    ["channel", "只能在启用中的小组创建渠道", "groupId"],
  ] as const)("places %s error %s under %s", (entity, message, field) => {
    expect(classifyAdminFormError(entity, message)).toEqual({ message, field });
  });

  it("keeps unrelated admin errors at form level", () => {
    expect(classifyAdminFormError("member", "系统至少保留一名启用中的管理员"))
      .toEqual({ message: "系统至少保留一名启用中的管理员", field: null });
  });

  it("keeps the current-account disable error at action level", () => {
    expect(classifyAdminFormError("member", "不能停用当前登录账号"))
      .toEqual({ message: "不能停用当前登录账号", field: null });
  });
});

describe("channel admin display", () => {
  it("uses US dollars consistently and distinguishes groups by department", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const groups = [
      {
        id: "group-a",
        name: "一组",
        active: true,
        departmentName: "A 部门",
      },
    ];
    const channels: ManagedChannel[] = [
      {
        id: "channel-free",
        name: "自然流量",
        groupId: "group-a",
        active: true,
        group: { id: "group-a", name: "一组", active: true },
        creator: null,
        createdAt: "2026-08-14T00:00:00.000Z",
        batchCount: 0,
      },
      {
        id: "channel-paid",
        name: "付费投放",
        groupId: "group-a",
        active: true,
        group: { id: "group-a", name: "一组", active: true },
        creator: null,
        createdAt: "2026-08-14T00:00:00.000Z",
        batchCount: 1,
      },
    ];

    const markup = renderToStaticMarkup(
      React.createElement(ChannelTable, {
        channels,
        groups,
        onEdit: () => undefined,
      }),
    );

    expect(formatChannelGroupLabel(groups[0])).toBe("A 部门 / 一组");
    expect(formatEffectiveFanPrice(5_000)).toBe("$50.00 / 有效数据");
    expect(markup).toContain("全部公司 / 1 个小组");
    expect(markup).not.toContain("¥");
  });
});

describe("audit log display", () => {

  it("renders a history edit audit with a Chinese action, target, and readable changed values", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const summary = JSON.stringify({
      occurredOn: { from: "2026-08-10", to: "2026-08-12" },
      batchId: { from: "source-a", to: "source-b" },
      metrics: {
        replies: { from: 5, to: 4 },
        rechargeCents: { from: 1234, to: 1000 },
      },
      request: { password: "never-show-this" },
    });
    const markup = renderToStaticMarkup(React.createElement(AuditLogTable, {
      initialLogs: [{
        id: "audit-history-1",
        actorId: "member-1",
        action: "HISTORY_GROUP_UPDATED",
        entityType: "HistoryGroup",
        entityId: "member-1::2026-08-10::source-a",
        summary,
        createdAt: "2026-08-12T00:00:00.000Z",
        actor: { id: "member-1", name: "组员", username: "member" },
      }],
      actors: [{ id: "member-1", name: "组员", username: "member" }],
      actions: ["HISTORY_GROUP_UPDATED"],
      timezone: "Asia/Shanghai",
    }));

    expect(markup).toContain("更新历史数据");
    expect(markup).toContain("历史数据 · 2026-08-10");
    expect(markup).toContain("发生日期：2026-08-10 → 2026-08-12");
    expect(markup).toContain("来源批次：#source-a → #source-b");
    expect(markup).toContain("回复：5 → 4");
    expect(markup).toContain("入金：$12.34 → $10.00");
    expect(markup).not.toContain("never-show-this");
  });
  it("shows a Chinese entity label and a shortened target id", () => {
    expect(formatAuditTarget("User", "c578d190-37c6-4b7b-a706-01f8a3eb4bb3", "{}"))
      .toBe("成员 · #c578d190");
    expect(formatAuditTarget("SystemSetting", "system", "{}"))
      .toBe("系统设置");
  });

  it("prefers an existing target name and translates changed fields", () => {
    const summary = JSON.stringify({ name: "渠道一", groupId: "group-1", groupName: "第一组", changedFields: ["name", "groupId", "active"] });
    expect(formatAuditTarget("Channel", "channel-id", summary)).toBe("渠道 · 渠道一 · 第一组");
    expect(formatAuditSummary(summary)).toBe("变更：名称、所属小组、启用状态");
  });

  it("shows high-risk reasons and readable before/after values without exposing the password", () => {
    const summary = JSON.stringify({
      name: "王小明",
      changedFields: ["role"],
      before: { role: "RECEPTION" },
      after: { role: "ADMIN" },
      highRiskReason: "业务负责人批准授权",
      currentPassword: "never-show-current-password",
    });

    expect(formatAuditSummary(summary)).toBe("变更：角色：前台接粉 → 管理员；操作原因：业务负责人批准授权");
    expect(formatAuditSummary(summary)).not.toContain("never-show-current-password");
  });

  it("labels an administrator grant audit and shows its reason and role transition", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const summary = JSON.stringify({
      name: "王小明",
      changedFields: ["role"],
      before: { role: "RECEPTION" },
      after: { role: "ADMIN" },
      highRiskReason: "负责人批准管理员授权",
    });
    const markup = renderToStaticMarkup(React.createElement(AuditLogTable, {
      initialLogs: [{
        id: "grant-admin-1",
        actorId: "admin-1",
        action: "MEMBER_ADMIN_GRANTED",
        entityType: "User",
        entityId: "member-1",
        summary,
        createdAt: "2026-08-15T00:00:00.000Z",
        actor: { id: "admin-1", name: "管理员", username: "admin" },
      }],
      actors: [{ id: "admin-1", name: "管理员", username: "admin" }],
      actions: ["MEMBER_ADMIN_GRANTED"],
      timezone: "Asia/Shanghai",
    }));

    expect(markup).toContain("授予管理员权限");
    expect(markup).toContain("角色：前台接粉 → 管理员");
    expect(markup).toContain("操作原因：负责人批准管理员授权");
  });

  it("labels an administrator password reset audit without showing password data", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const summary = JSON.stringify({
      name: "系统管理员",
      changedFields: ["password"],
      before: { role: "ADMIN" },
      after: { role: "LEAD" },
      highRiskReason: "账号交接后重置管理员密码",
      currentPassword: "never-show-current-password",
    });
    const markup = renderToStaticMarkup(React.createElement(AuditLogTable, {
      initialLogs: [{
        id: "reset-admin-password-1",
        actorId: "admin-1",
        action: "MEMBER_ADMIN_PASSWORD_RESET",
        entityType: "User",
        entityId: "member-1",
        summary,
        createdAt: "2026-08-15T00:00:00.000Z",
        actor: { id: "admin-1", name: "管理员", username: "admin" },
      }],
      actors: [{ id: "admin-1", name: "管理员", username: "admin" }],
      actions: ["MEMBER_ADMIN_PASSWORD_RESET"],
      timezone: "Asia/Shanghai",
    }));

    expect(markup).toContain("重置管理员密码");
    expect(markup).toContain("操作原因：账号交接后重置管理员密码");
    expect(markup).not.toContain("never-show-current-password");
  });

  it("labels administrator reactivation and access revocation audits", () => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    const actor = { id: "admin-1", name: "管理员", username: "admin" };
    const markup = renderToStaticMarkup(React.createElement(AuditLogTable, {
      initialLogs: [
        {
          id: "reactivate-admin-1",
          actorId: actor.id,
          action: "MEMBER_ADMIN_REACTIVATED",
          entityType: "User",
          entityId: "member-1",
          summary: JSON.stringify({
            name: "系统管理员",
            changedFields: ["active"],
            before: { active: false, role: "ADMIN" },
            after: { active: true, role: "ADMIN" },
            highRiskReason: "管理员结束休假恢复工作",
          }),
          createdAt: "2026-08-15T00:00:00.000Z",
          actor,
        },
        {
          id: "revoke-admin-1",
          actorId: actor.id,
          action: "MEMBER_ADMIN_ACCESS_REVOKED",
          entityType: "User",
          entityId: "member-2",
          summary: JSON.stringify({
            name: "离岗管理员",
            changedFields: ["role"],
            before: { role: "ADMIN" },
            after: { role: "LEAD" },
            highRiskReason: "管理员离岗后撤销权限",
          }),
          createdAt: "2026-08-15T00:00:00.000Z",
          actor,
        },
      ],
      actors: [actor],
      actions: ["MEMBER_ADMIN_REACTIVATED", "MEMBER_ADMIN_ACCESS_REVOKED"],
      timezone: "Asia/Shanghai",
    }));

    expect(markup).toContain("重新启用管理员账号");
    expect(markup).toContain("撤销管理员权限");
    expect(markup).toContain("启用状态：停用 → 启用");
    expect(markup).toContain("角色：管理员 → 组长");
    expect(markup).toContain("操作原因：管理员结束休假恢复工作");
    expect(markup).toContain("操作原因：管理员离岗后撤销权限");
  });

  it("formats high-risk status and channel-price changes as business values", () => {
    expect(formatAuditSummary(JSON.stringify({
      changedFields: ["active"],
      before: { active: true },
      after: { active: false },
      highRiskReason: "组织调整后停止使用",
    }))).toBe("变更：启用状态：启用 → 停用；操作原因：组织调整后停止使用");

    expect(formatAuditSummary(JSON.stringify({
      changedFields: ["effectiveFanPriceCents"],
      before: { effectiveFanPriceCents: 5_000 },
      after: { effectiveFanPriceCents: 0 },
      highRiskReason: "渠道已经转为免费来源",
    }))).toBe("变更：有效数据单价：$50.00 / 有效数据 → $0.00 / 有效数据；操作原因：渠道已经转为免费来源");
  });

  it("uses the stored group id when an inline-created channel log has no group name", () => {
    const summary = JSON.stringify({ name: "临时渠道", groupId: "a1b2c3d4-e5f6-7890", source: "new_fans_entry" });
    expect(formatAuditTarget("Channel", "channel-id", summary)).toBe("渠道 · 临时渠道 · 小组 #a1b2c3d4");
  });

  it("formats the same instant in the configured business timezone", () => {
    const instant = "2026-08-11T20:30:00.000Z";
    expect(formatAuditTime(instant, "Asia/Shanghai")).toBe("08月12日 04:30");
    expect(formatAuditTime(instant, "America/Los_Angeles")).toBe("08月11日 13:30");
  });
});
