"use client";

import { Bell, CircleNotch, Key, SignOut } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { AppNavigationRole } from "../../lib/app-navigation";
import { WorkflowConfirmationDialog } from "../ui/WorkflowConfirmationDialog";

const names: Record<string, string> = {
  entry: "数据录入",
  history: "历史记录",
  reports: "转化报表",
  "personal-data": "个人数据",
  "team-members": "组员管理",
  admin: "管理员中心",
  "team-performance": "组员对比",
  "channel-analysis": "渠道对比",
  "anomaly-ranking": "成员每日明细",
  "batch-tracking": "批次追踪",
  "group-customers": "炒群明细",
  "expert-customers": "专家客户情况",
  "resource-conversion": "入群后跟进",
  "resource-channels": "渠道与单价",
  "performance-leaderboard": "精英榜",
  "management-rankings": "全部门完整榜单",
  notifications: "通知中心",
  "finance-reports": "财务报表",
  "legacy-customers": "老客户补录",
  "change-password": "账号安全",
  personnel: "人员档案",
};

export function AppHeader({
  appName,
  userName,
  role,
  roleLabel,
  groupName,
  timezone,
  unreadNotifications = 0,
}: {
  appName: string;
  userName: string;
  role: AppNavigationRole;
  roleLabel: string;
  groupName?: string;
  timezone: string;
  unreadNotifications?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const key = pathname.split("/").filter(Boolean)[0] ?? "dashboard";
  const memberNames: Record<string, string> = {
    dashboard: "今日待办",
    entry: "客户跟进",
    "personal-data": "个人数据",
    "performance-leaderboard": "精英榜",
    "finance-reports": "每日数据报表",
    notifications: "通知中心",
    "legacy-customers": "老客户补录",
  };
  const leadNames: Record<string, string> = {
    dashboard: "组长工作台",
    history: "接粉明细",
    "group-customers": "炒群明细",
    "expert-customers": "专家管理",
    "team-performance": "团队表现",
    "role-rankings": "团队表现 · 完整榜单",
    "anomaly-ranking": "团队表现 · 成员每日明细",
    "channel-analysis": "渠道与批次",
    "batch-tracking": "渠道与批次 · 批次追踪",
    "performance-leaderboard": "精英榜",
    notifications: "通知中心",
  };
  const resourceNames: Record<string, string> = {
    dashboard: "资源工作台",
    "channel-analysis": "渠道表现",
    "resource-conversion": "入群后跟进",
    "resource-channels": "渠道与单价",
    "performance-leaderboard": "精英榜",
    notifications: "通知中心",
  };
  const companyNames: Record<string, string> = {
    dashboard: "公司工作台",
    "team-performance": "公司数据汇总",
    "channel-analysis": "渠道分析",
    "company-organization": "公司组织管理",
    "performance-leaderboard": "精英榜",
    "management-rankings": "全部门完整榜单",
  };
  const financeNames: Record<string, string> = {
    "finance-reports": "财务报表",
    "team-performance": "公司数据汇总",
    "channel-analysis": "渠道分析",
    "role-rankings": "完整榜单",
    notifications: "通知中心",
  };
  const receptionEntryTitle = searchParams.get("workspace") === "handoff" || searchParams.get("tab") === "group"
    ? "入群交接"
    : "接粉处理";
  const title =
    role === "RECEPTION"
      ? (key === "entry" ? receptionEntryTitle : memberNames[key] ?? names[key] ?? appName)
      : role === "LEAD"
        ? (leadNames[key] ?? names[key] ?? appName)
      : role === "RESOURCE_MANAGER"
        ? (resourceNames[key] ?? names[key] ?? appName)
      : role === "COMPANY_MANAGER"
        ? (companyNames[key] ?? names[key] ?? appName)
      : role === "FINANCE"
        ? (financeNames[key] ?? names[key] ?? appName)
      : role === "HR"
        ? (key === "attendance" ? "考勤管理" : key === "personnel" ? "人员档案" : appName)
      : key === "team-performance"
        ? "团队表现"
      : key === "dashboard"
        ? "总公司工作台"
        : (names[key] ?? appName);
  const isReceptionEntry = pathname === "/entry" && role === "RECEPTION";
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: timezone,
  }).format(new Date());
  async function logout() {
    setBusy(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setLogoutError("退出失败，请稍后再试");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("网络连接失败，无法退出，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }
  function requestLogout() {
    setLogoutError("");
    setConfirmingLogout(true);
  }
  return (
    <>
      <header aria-label="当前登录信息" className={`app-topbar${isReceptionEntry ? " app-topbar--reception-entry" : ""}`}>
        <div>
          <p className="app-topbar-title">{title}</p>
          <p className="app-topbar-breadcrumb">
            {appName} / {title}
          </p>
        </div>
        <div className="app-topbar-actions">
          <span className="app-topbar-date">{date}</span>
          <div data-testid="app-header-identity" className="app-header-identity">
            <span className="app-header-user">{userName}</span>
            <span className="app-header-scope">
              {groupName ? `${roleLabel} · ${groupName}` : roleLabel}
            </span>
          </div>
          {role !== "HR" ? <Link href="/notifications" className="relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700" aria-label={unreadNotifications ? `通知中心，${unreadNotifications} 条未读` : "通知中心"} title="通知中心">
            <Bell size={19} weight="bold" />
            {unreadNotifications ? <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-5 text-white">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span> : null}
          </Link> : null}
          <Link href="/change-password" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700" aria-label="修改登录密码" title="修改登录密码">
            <Key size={17} weight="bold" />
            <span className="hidden lg:inline">修改密码</span>
          </Link>
          {logoutError ? <p role="alert" className="sr-only">{logoutError}</p> : null}
          <button
            className="app-logout"
            type="button"
            onClick={requestLogout}
            disabled={busy}
            aria-haspopup="dialog"
            title="安全退出当前账号"
          >
            <span className="app-logout-icon" aria-hidden="true">
              {busy ? <CircleNotch size={17} weight="bold" className="animate-spin" /> : <SignOut size={17} weight="bold" />}
            </span>
            <span className="app-logout-label">{busy ? "退出中…" : "退出登录"}</span>
          </button>
        </div>
      </header>
      <WorkflowConfirmationDialog
        confirmation={confirmingLogout ? {
          title: "确认退出登录？",
          description: "退出后需要重新输入账号和密码才能继续使用。",
          target: `${userName} · ${groupName ? `${roleLabel} · ${groupName}` : roleLabel}`,
          confirmLabel: "确认退出",
          tone: "danger",
          onConfirm: logout,
        } : null}
        busy={busy}
        error={logoutError}
        onClose={() => {
          if (busy) return;
          setConfirmingLogout(false);
          setLogoutError("");
        }}
      />
    </>
  );
}
