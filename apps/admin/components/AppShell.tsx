"use client";

import { AccountMenu } from "../../../packages/auth/AccountMenu";
import { adminPath } from "../lib/app-path";
import { IconChart } from "./Icons";
import styles from "./AppShell.module.css";
import { adminNavigation, type Role } from "../lib/navigation";
import { ActionConfirmationBoundary } from "./ActionConfirmationBoundary";

export type { Role } from "../lib/navigation";

/** 仅给未接入的旧原型组件保留类型兼容；真实页面始终使用登录接口返回的 viewer。 */
export const ROLE_META: Record<Role, { name: string; title: string; scope: string }> = {
  LEAD: { name: "当前组长", title: "组长", scope: "所属小组" },
  DEPT_MANAGER: { name: "当前部门管理员", title: "部门管理员", scope: "所属部门" },
  COMPANY_MANAGER: { name: "当前公司管理员", title: "公司管理员", scope: "所属公司" },
  HQ_MANAGER: { name: "当前总公司管理员", title: "总公司管理员", scope: "总公司" },
  RESOURCE_TRAFFIC: { name: "当前投流资源管理员", title: "资源部·投流", scope: "投流渠道" },
  RESOURCE_SMS: { name: "当前短信资源管理员", title: "资源部·短信", scope: "短信渠道" },
};

export function AppShell({
  role, active, title, breadcrumb, children, onNavigate, viewer, onLogout, assistant,
}: {
  role: Role;
  assistant?: React.ReactNode;
  active: string;
  title: string;
  breadcrumb: string;
  children: React.ReactNode;
  reviewPendingCount?: number;
  onNavigate: (id: string) => void;
  viewer: { name: string; title: string; scope: string };
  onLogout: () => void | Promise<void>;
  onToast?: (msg: string, tone?: "ok" | "warn") => void;
}) {
  const NAV = adminNavigation(role);
  const persona = viewer;
  const now = new Date();
  const localDate = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
  const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;


  return (
    <ActionConfirmationBoundary>
    <div className={styles.shell}>
      <aside className={styles.sidebar}
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
                {section.items.map(({ id, title: label, Icon }) => {
                  const on = id === active;
                  return (
                    <a
                      key={id} href="#" aria-current={on ? "page" : undefined}
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
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header className={styles.header}>
          <div className={styles.heading}><h1>{title}</h1><p>{breadcrumb}</p></div>
          <div className={styles.actions}>{assistant}
            <div className={styles.clock}><p>{localDate}</p><small>当前登录身份 · {isoDate}</small></div>
            <AccountMenu name={persona.name} roleLabel={persona.title} scope={persona.scope} changePasswordHref={adminPath("/change-password")} onLogout={onLogout} />
          </div>
        </header>

        <main style={{ flex: 1, padding: "22px 24px 40px" }}>{children}</main>
      </div>
    </div>
    </ActionConfirmationBoundary>
  );
}
