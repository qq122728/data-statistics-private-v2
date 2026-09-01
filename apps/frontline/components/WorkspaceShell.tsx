"use client";

import type { ReactNode } from "react";
import {
  ArrowsLeftRight, Bell, Broadcast, CalendarBlank, ChartLine, Devices,
  Gear, MagnifyingGlass, Sigma, SquaresFour, Table, Tag, TreeStructure,
  UserGear, WarningCircle,
} from "@phosphor-icons/react";
import styles from "./WorkspaceShell.module.css";

export type WorkspaceIcon = "dashboard" | "summary" | "search" | "organization" | "devices" | "notifications" | "settings" | "transfer" | "calendar" | "sigma" | "channel" | "usage" | "accounts" | "analysis" | "warning";

const NAV_ICONS = {
  dashboard: SquaresFour,
  summary: Table,
  search: MagnifyingGlass,
  organization: TreeStructure,
  devices: Devices,
  notifications: Bell,
  settings: Gear,
  transfer: ArrowsLeftRight,
  calendar: CalendarBlank,
  sigma: Sigma,
  channel: Tag,
  usage: Broadcast,
  accounts: UserGear,
  analysis: ChartLine,
  warning: WarningCircle,
} satisfies Record<WorkspaceIcon, typeof SquaresFour>;

export type WorkspaceShellProps = {
  mark: string;
  workspaceLabel: string;
  title: string;
  subtitle: string;
  userName: string;
  userLabel: string;
  onLogout: () => void;
  navigation: ReactNode;
  assistant?: ReactNode;
  scope?: { label: string; value: ReactNode };
  children: ReactNode;
};

export function WorkspaceShell({ mark, workspaceLabel, title, subtitle, userName, userLabel, onLogout, navigation, assistant, scope, children }: WorkspaceShellProps) {
  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><span>{mark}</span><div><strong>数据统计</strong><small>{workspaceLabel}</small></div></div>
      <nav className={styles.nav} aria-label={`${workspaceLabel}功能导航`}>{navigation}</nav>
      {scope ? <div className={styles.scope}><strong>{scope.label}</strong><span>{scope.value}</span></div> : null}
    </aside>
    <section className={styles.main}>
      <header className={styles.header}>
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        <div className={styles.headerActions}>{assistant}<div className={styles.user}><span>{userName.slice(0, 1)}</span><div><strong>{userName}</strong><small>{userLabel}</small></div><button type="button" className={styles.logout} onClick={onLogout}>退出</button></div></div>
      </header>
      <main className={styles.content}>{children}</main>
    </section>
  </div>;
}

export function WorkspaceNavButton({ active, icon, onClick, children }: { active: boolean; icon?: WorkspaceIcon; onClick: () => void; children: ReactNode }) {
  const Icon = icon ? NAV_ICONS[icon] : null;
  return <button type="button" className={styles.navButton} data-active={active} aria-current={active ? "page" : undefined} onClick={onClick}>{Icon ? <i aria-hidden="true"><Icon size={17} weight={active ? "fill" : "regular"} /></i> : null}<span>{children}</span></button>;
}

export function WorkspaceNavGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.navGroup}><small>{label}</small>{children}</div>;
}
