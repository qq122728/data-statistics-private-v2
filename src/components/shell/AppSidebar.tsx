"use client";

import {
  CaretDown,
  Bell,
  ChartBar,
  ClockCounterClockwise,
  Database,
  Gauge,
  ShieldCheck,
  UsersThree,
  UserFocus,
  WarningDiamond,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getVisibleAppNavigationSections,
  type AppNavigationRole,
} from "../../lib/app-navigation";

const iconByHref: Record<string, typeof ChartBar> = {
  "/dashboard": Gauge,
  "/device-accounts": Database,
  "/attendance": ClockCounterClockwise,
  "/notifications": Bell,
  "/entry": Database,
  "/history": ClockCounterClockwise,
  "/reports": ChartBar,
  "/personal-data": ChartBar,
  "/team-members": UsersThree,
  "/admin": ShieldCheck,
  "/company-organization": UsersThree,
  "/team-performance": Gauge,
  "/group-daily-detail": ChartBar,
  "/channel-analysis": ChartBar,
  "/anomaly-ranking": WarningDiamond,
  "/batch-tracking": ClockCounterClockwise,
  "/group-customers": UsersThree,
  "/expert-customers": UserFocus,
  "/customer-follow-up": UserFocus,
  "/customer-timeline": ClockCounterClockwise,
  "/resource-conversion": UserFocus,
  "/resource-channels": Database,
  "/performance-leaderboard": ChartBar,
  "/management-rankings": ChartBar,
  "/role-rankings": ChartBar,
  "/finance-reports": ChartBar,
  "/legacy-customers": UserFocus,
  "/personnel": UsersThree,
} as const;

export function AppSidebar({
  appName,
  user,
}: {
  appName: string;
  user: {
    name: string;
    role: AppNavigationRole;
    roles?: AppNavigationRole[];
    roleLabel: string;
    groupName?: string;
    departmentManager?: boolean;
  };
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 接粉工作台是高频录入页：在该页切换为窄图标栏，把横向空间还给客户资料和操作。
  const isReceptionEntry = pathname === "/entry" && (user.roles?.includes("RECEPTION") ?? user.role === "RECEPTION");
  const sections = getVisibleAppNavigationSections(user.roles?.length ? user.roles : user.role)
    .map((section) => user.departmentManager
      ? { ...section, items: section.items.filter((item) => item.href !== "/resource-channels") }
      : section)
    .filter((section) => section.items.length > 0);
  const isActive = (href: string) => {
    const [hrefPath, hrefQuery] = href.split("?");
    const queryMatches = hrefQuery
      ? [...new URLSearchParams(hrefQuery).entries()]
        .every(([key, value]) => searchParams.get(key) === value)
      // 小组每日明细允许带多个小组和日期筛选；这些筛选不应该让当前入口失去高亮。
      : hrefPath === "/group-daily-detail" || searchParams.size === 0;
    const leadTeamRoute = user.role === "LEAD" && href === "/team-performance" && ["/team-performance", "/role-rankings", "/anomaly-ranking"].includes(pathname);
    const leadAcquisitionRoute = user.role === "LEAD" && href === "/channel-analysis" && ["/channel-analysis", "/batch-tracking"].includes(pathname);
    return (pathname === hrefPath && queryMatches) || pathname.startsWith(`${hrefPath}/`) || leadTeamRoute || leadAcquisitionRoute;
  };

  const renderItem = ({ href, label }: { href: string; label: string }) => {
    const [hrefPath] = href.split("?");
    const Icon = iconByHref[hrefPath] ?? Database;
    const active = isActive(href);
    return (
      <Link key={href} href={href} className="app-nav-link" data-active={active} title={label}>
        <Icon size={20} weight={active ? "fill" : "regular"} />
        <span>{label}</span>
      </Link>
    );
  };

  const collapsibleIcon = (label: string) => label === "客户管理" ? UsersThree : ChartBar;

  return (
    <aside className={`app-sidebar${isReceptionEntry ? " app-sidebar--reception-entry" : ""}`}>
      <div className="app-brand-wrap">
        <div className="app-brand-mark">
          <ChartBar size={18} weight="bold" />
        </div>
        <div className="min-w-0">
          <p className="app-brand truncate">{appName}</p>
          <p className="app-brand-subtitle">Data Console</p>
        </div>
      </div>
      <nav aria-label="应用导航" className="app-nav">
        {sections.map((section, sectionIndex) => (
          <div key={`${section.label}-${sectionIndex}`} className="app-nav-section">
            {section.collapsible ? (() => {
              const SectionIcon = collapsibleIcon(section.label);
              const sectionActive = section.items.some((item) => isActive(item.href));
              return (
                <details className={`app-nav-disclosure${section.label === "经营分析" ? " app-nav-disclosure--analysis" : ""}`} open={sectionActive}>
                  <summary className="app-nav-disclosure-summary" data-active={sectionActive}>
                    <SectionIcon size={20} weight={sectionActive ? "fill" : "regular"} />
                    <span>{section.label}</span>
                    <CaretDown className="app-nav-disclosure-caret" size={16} weight="bold" aria-hidden="true" />
                  </summary>
                  <div className="app-nav-disclosure-items">{section.items.map(renderItem)}</div>
                </details>
              );
            })() : <>
              {section.label ? <p className="app-nav-section-label">{section.label}</p> : null}
              {section.items.map(renderItem)}
            </>}
          </div>
        ))}
      </nav>
      <div className="app-sidebar-user">
        <div className="app-user-row">
          <div className="app-avatar">{user.name.slice(0, 1)}</div>
          <div className="min-w-0">
            <p className="app-user-name truncate">{user.name}</p>
            <p className="app-user-role truncate">
              {user.roleLabel}
              {user.groupName ? ` · ${user.groupName}` : ""}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
