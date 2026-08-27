"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { leadDateRangeQuery, type LeadDateRange } from "../../lib/lead-date-range";

const tabs = {
  customers: [
    { href: "/history", label: "接粉明细" },
    { href: "/group-customers", label: "炒群明细" },
    { href: "/expert-customers", label: "专家与开单" },
  ],
  team: [
    { href: "/team-performance", label: "数据汇总" },
    { href: "/role-rankings", label: "完整榜单" },
    { href: "/anomaly-ranking", label: "成员每日明细" },
  ],
  acquisition: [
    { href: "/channel-analysis", label: "渠道表现" },
    { href: "/batch-tracking", label: "批次追踪" },
  ],
} as const;

export function LeadWorkspaceTabs({ kind, dateRange }: { kind: keyof typeof tabs; dateRange?: LeadDateRange }) {
  const pathname = usePathname();
  return (
    <nav className="lead-workspace-tabs" aria-label={kind === "customers" ? "客户转化阶段" : kind === "team" ? "团队表现视图" : "渠道与批次视图"}>
      {tabs[kind].map((tab) => <Link key={tab.href} href={dateRange ? `${tab.href}?${leadDateRangeQuery(dateRange)}` : tab.href} data-active={pathname === tab.href}>{tab.label}</Link>)}
    </nav>
  );
}
