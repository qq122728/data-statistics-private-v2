"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconBell, IconChart, IconChevronDown, IconDevice, IconKey, IconLogout, IconRoute, IconSearch,
  IconTrophy, IconUsers,
} from "./Icons";
import { ActionConfirmationBoundary } from "./ActionConfirmationBoundary";

/** 演示环境里用来切换"查看身份"的六种角色——组长（已有的完整工作台）、部门管理员
 *  （只读客户数据，但对本部门组织结构：组长任免/跨组调岗有直接操作权）、公司管理员
 *  （只读客户数据，看本公司所有部门，可能跨国；组织结构上"可越级"，除了任免部门管理员
 *  还能直接任免任意部门下任意小组的组长、发起任意跨组调组，需求文档 5.6）、总公司管理员
 *  （只读客户数据，看"全部"——跨所有公司，需求文档 5.2；组织结构上再"可越级"一层，
 *  任免公司管理员/部门管理员/组长全都能直接操作，另外新增下级角色都没有的能力：新建
 *  公司、新建部门，需求文档 5.6）、资源部的两个账号（RESOURCE_TRAFFIC/RESOURCE_SMS）
 *  ——资源部管渠道数据，是拆成"投流""短信"两个独立账号的，每个账号绑死一个渠道，看的是
 *  全公司口径（不是像部门管理员那样按部门分），不管人也不管组织结构，所以没有"组织管理"
 *  这个导航分组。 */
export type Role = "LEAD" | "DEPT_MANAGER" | "COMPANY_MANAGER" | "HQ_MANAGER" | "RESOURCE_TRAFFIC" | "RESOURCE_SMS";

/** 仅给未接入的旧原型组件保留类型兼容；真实页面始终使用登录接口返回的 viewer。 */
export const ROLE_META: Record<Role, { name: string; title: string; scope: string }> = {
  LEAD: { name: "当前组长", title: "组长", scope: "所属小组" },
  DEPT_MANAGER: { name: "当前部门管理员", title: "部门管理员", scope: "所属部门" },
  COMPANY_MANAGER: { name: "当前公司管理员", title: "公司管理员", scope: "所属公司" },
  HQ_MANAGER: { name: "当前总公司管理员", title: "总公司管理员", scope: "总公司" },
  RESOURCE_TRAFFIC: { name: "当前投流资源管理员", title: "资源部·投流", scope: "投流渠道" },
  RESOURCE_SMS: { name: "当前短信资源管理员", title: "资源部·短信", scope: "短信渠道" },
};

type NavItem = { id: string; label: string; Icon: (props: { size?: number; className?: string }) => React.ReactElement; dotKey?: "review" };
type NavSection = { group: string; items: NavItem[] };

const NAV_LEAD: NavSection[] = [
  {
    group: "日常工作",
    items: [
      { id: "followup", label: "客户进度工作台", Icon: IconRoute },
      { id: "expert-daily", label: "每日数据填写", Icon: IconChart },
      { id: "summary", label: "数据汇总", Icon: IconChart },
      { id: "channel", label: "渠道数据核对", Icon: IconSearch },
      { id: "notice", label: "通知中心", Icon: IconBell },
    ],
  },
  {
    group: "我的数据",
    items: [
      { id: "members", label: "组员管理", Icon: IconUsers },
      { id: "devices", label: "设备管理", Icon: IconDevice },
      { id: "dashboard", label: "我的看板", Icon: IconChart },
      { id: "leaderboard", label: "精英榜", Icon: IconTrophy },
    ],
  },
];

const NAV_DEPT_MANAGER: NavSection[] = [
  {
    group: "日常工作",
    items: [
      { id: "team-overview", label: "部门工作台", Icon: IconChart },
      { id: "team-detail", label: "数据汇总", Icon: IconSearch },
      { id: "management-customer-progress", label: "客户进度", Icon: IconRoute },
      { id: "dept-notice", label: "通知中心", Icon: IconBell },
    ],
  },
  {
    group: "组织管理",
    items: [
      { id: "group-leadership", label: "小组与人员管理", Icon: IconUsers },
      { id: "dept-leaderboard", label: "精英榜", Icon: IconTrophy },
    ],
  },
];

const NAV_COMPANY_MANAGER: NavSection[] = [
  {
    group: "日常工作",
    items: [
      { id: "company-overview", label: "部门汇总", Icon: IconChart },
      { id: "company-detail", label: "部门明细", Icon: IconSearch },
      { id: "management-customer-progress", label: "客户进度", Icon: IconRoute },
      { id: "company-notice", label: "通知中心", Icon: IconBell },
    ],
  },
  {
    group: "组织管理",
    items: [
      { id: "company-leadership", label: "部门与组长人事", Icon: IconUsers },
      { id: "company-leaderboard", label: "精英榜", Icon: IconTrophy },
    ],
  },
];

const NAV_HQ_MANAGER: NavSection[] = [
  {
    group: "日常工作",
    items: [
      { id: "hq-overview", label: "公司汇总", Icon: IconChart },
      { id: "hq-detail", label: "公司明细", Icon: IconSearch },
      { id: "management-customer-progress", label: "客户进度", Icon: IconRoute },
      { id: "hq-notice", label: "通知中心", Icon: IconBell },
    ],
  },
  {
    group: "组织管理",
    items: [
      { id: "hq-leadership", label: "全局人事", Icon: IconUsers },
      { id: "channel-settings", label: "渠道设置", Icon: IconSearch },
      { id: "hq-leaderboard", label: "精英榜", Icon: IconTrophy },
    ],
  },
];

const NAV_RESOURCE: NavSection[] = [
  {
    group: "日常工作",
    items: [
      { id: "resource-summary", label: "渠道数据汇总", Icon: IconChart },
      { id: "resource-group-detail", label: "小组明细", Icon: IconSearch },
      { id: "resource-notice", label: "通知中心", Icon: IconBell },
    ],
  },
];

export function AppShell({
  role, active, title, breadcrumb, children, reviewPendingCount = 0, onNavigate, viewer, onLogout, onToast,
}: {
  role: Role;
  active: string;
  title: string;
  breadcrumb: string;
  children: React.ReactNode;
  reviewPendingCount?: number;
  onNavigate: (id: string) => void;
  viewer: { name: string; title: string; scope: string };
  onLogout?: () => void | Promise<void>;
  onToast?: (msg: string, tone?: "ok" | "warn") => void;
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const NAV = role === "DEPT_MANAGER" ? NAV_DEPT_MANAGER
    : role === "COMPANY_MANAGER" ? NAV_COMPANY_MANAGER
    : role === "HQ_MANAGER" ? NAV_HQ_MANAGER
    : role === "RESOURCE_TRAFFIC" || role === "RESOURCE_SMS" ? NAV_RESOURCE
    : NAV_LEAD;
  const persona = viewer;
  const now = new Date();
  const localDate = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
  const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  useEffect(() => {
    if (!userMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [userMenuOpen]);

  return (
    <ActionConfirmationBoundary>
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: "var(--sidebar-w)", flexShrink: 0, background: "var(--surface)",
          borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column",
          position: "sticky", top: 0, height: "100vh",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 10, height: "var(--header-h)",
          padding: "0 18px", borderBottom: "1px solid var(--line)",
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: "var(--accent)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <IconChart size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>数据统计</p>
            <p style={{ margin: 0, fontSize: 10, letterSpacing: "0.09em", color: "var(--ink-3)", lineHeight: 1.2 }}>
              管理端 · {viewer?.title ?? "管理账号"}
            </p>
          </div>
        </div>

        <nav style={{ flex: 1, padding: "14px 12px", overflowY: "auto" }}>
          {NAV.map((section) => (
            <div key={section.group} style={{ marginBottom: 20 }}>
              <p style={{ margin: "0 0 6px 10px", fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)", letterSpacing: "0.04em" }}>
                {section.group}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {section.items.map(({ id, label, Icon, dotKey }) => {
                  const on = id === active;
                  const showDot = dotKey === "review" && reviewPendingCount > 0;
                  return (
                    <a
                      key={id} href="#"
                      onClick={(e) => { e.preventDefault(); onNavigate(id); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 8,
                        fontSize: 14, fontWeight: on ? 600 : 500,
                        color: on ? "var(--accent)" : "var(--ink-2)",
                        background: on ? "var(--accent-soft)" : "transparent",
                        textDecoration: "none", cursor: "pointer",
                      }}
                    >
                      <Icon size={19} />
                      <span>{label}</span>
                      {showDot ? (
                        <span style={{
                          marginLeft: "auto", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999,
                          background: "var(--bad)", color: "#fff", fontSize: 11, fontWeight: 700,
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {reviewPendingCount}
                        </span>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header style={{
          height: "var(--header-h)", flexShrink: 0, display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "0 24px", background: "var(--surface)",
          borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 20,
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 16.5, fontWeight: 700 }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>{breadcrumb}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{localDate}</p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>当前登录身份 · {isoDate}</p>
            </div>
            <div style={{ width: 1, height: 28, background: "var(--line)" }} />
            <div ref={menuRef} style={{ position: "relative" }}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                style={{
                  all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 6px", borderRadius: 8,
                  background: userMenuOpen ? "var(--surface-sunken)" : "transparent",
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 999, background: "#374151", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 600, flexShrink: 0,
                }}>
                  {persona.name[0]}
                </div>
                <div style={{ minWidth: 0, textAlign: "left" }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{persona.name}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{persona.title} · {persona.scope}</p>
                </div>
                <IconChevronDown size={16} />
              </button>
              {userMenuOpen ? (
                <div role="menu" style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30, width: 180,
                  background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius)",
                  boxShadow: "0 10px 30px rgba(19,24,36,.14)", padding: 6, display: "flex", flexDirection: "column", gap: 2,
                }}>
                  <button
                    onClick={() => { setUserMenuOpen(false); window.location.assign("/change-password"); }}
                    style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 6, fontSize: 13.5, color: "var(--ink-2)" }}
                  >
                    <IconKey size={16} />修改密码
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); void onLogout?.(); }}
                    style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 6, fontSize: 13.5, color: "var(--bad)" }}
                  >
                    <IconLogout size={16} />退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main style={{ flex: 1, padding: "22px 24px 40px" }}>{children}</main>
      </div>
    </div>
    </ActionConfirmationBoundary>
  );
}
