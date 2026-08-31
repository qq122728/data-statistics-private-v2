"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconBell,
  IconBoard,
  IconChart,
  IconChevronDown,
  IconDevice,
  IconKey,
  IconLogout,
  IconTrophy,
} from "./Icons";
import { ActionConfirmationBoundary } from "./ActionConfirmationBoundary";

/** 岗位能力统一收进“客户进度工作台”，统计数字在“每日数据填写”单独维护。 */
const NAV = [
  {
    group: "日常工作",
    items: [
      { id: "customerProgress", label: "客户进度工作台", Icon: IconBoard, dot: false },
      { id: "dailyData", label: "每日数据填写", Icon: IconChart, dot: false },
      { id: "notice", label: "通知中心", Icon: IconBell, dot: true },
      { id: "device", label: "设备账号", Icon: IconDevice, dot: false },
    ],
  },
  {
    group: "我的数据",
    items: [
      { id: "mine", label: "我的业绩", Icon: IconChart, dot: false },
      { id: "rank", label: "精英榜", Icon: IconTrophy, dot: false },
    ],
  },
];

const NAVIGABLE = new Set(["customerProgress", "dailyData", "notice", "device", "mine", "rank"]);

export function AppShell({
  active = "customerProgress",
  title,
  breadcrumb,
  children,
  onNavigate,
  onToast,
  viewer,
  onLogout,
}: {
  active?: string;
  title: string;
  breadcrumb: string;
  children: React.ReactNode;
  /** 点了导航里真正能跳转的入口时回调；其它还是占位死链接 */
  onNavigate?: (id: string) => void;
  /** 重置密码/退出登录这些没有真正后端的动作，用这个报一条提示 */
  onToast?: (msg: string, tone?: "ok" | "warn") => void;
  viewer: { name: string; title: string; scope: string; timezoneLabel: string };
  onLogout: () => void | Promise<void>;
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      {/* 侧边栏 */}
      <aside
        style={{
          width: "var(--sidebar-w)",
          flexShrink: 0,
          background: "var(--surface)",
          borderRight: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        {/* 品牌 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            height: "var(--header-h)",
            padding: "0 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--accent)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <IconChart size={17} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>数据统计</p>
            <p
              style={{
                margin: 0,
                fontSize: 10,
                letterSpacing: "0.09em",
                color: "var(--ink-3)",
                lineHeight: 1.2,
              }}
            >
              DATA CONSOLE
            </p>
          </div>
        </div>

        {/* 导航 */}
        <nav style={{ flex: 1, padding: "14px 12px", overflowY: "auto" }}>
          {NAV.map((section) => (
            <div key={section.group} style={{ marginBottom: 20 }}>
              <p
                style={{
                  margin: "0 0 6px 10px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--ink-3)",
                  letterSpacing: "0.04em",
                }}
              >
                {section.group}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {section.items.map(({ id, label, Icon, dot }) => {
                  const on = id === active;
                  const clickable = NAVIGABLE.has(id);
                  return (
                    <a
                      key={id}
                      href="#"
                      onClick={(e) => { e.preventDefault(); if (clickable) onNavigate?.(id); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 10px",
                        borderRadius: 8,
                        fontSize: 14,
                        fontWeight: on ? 600 : 500,
                        color: on ? "var(--accent)" : "var(--ink-2)",
                        background: on ? "var(--accent-soft)" : "transparent",
                        textDecoration: "none",
                        position: "relative",
                        cursor: clickable ? "pointer" : "default",
                      }}
                    >
                      <Icon size={19} />
                      <span>{label}</span>
                      {dot ? (
                        <span
                          style={{
                            marginLeft: "auto",
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            background: "var(--bad)",
                          }}
                        />
                      ) : null}
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* 主区 */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            height: "var(--header-h)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            background: "var(--surface)",
            borderBottom: "1px solid var(--line)",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 16.5, fontWeight: 700 }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
              {breadcrumb}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
                {new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date())}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
                {viewer.timezoneLabel}
              </p>
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
                <div
                  style={{
                    width: 32, height: 32, borderRadius: 999, background: "#374151", color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 600, flexShrink: 0,
                  }}
                >
                  {viewer.name[0]}
                </div>
                <div style={{ minWidth: 0, textAlign: "left" }}>
                  <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>{viewer.name}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{viewer.title} · {viewer.scope}</p>
                </div>
                <IconChevronDown size={16} />
              </button>

              {userMenuOpen ? (
                <div
                  role="menu"
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
                    width: 180, background: "var(--surface)", border: "1px solid var(--line)",
                    borderRadius: "var(--radius)", boxShadow: "0 10px 30px rgba(19,24,36,.14)",
                    padding: 6, display: "flex", flexDirection: "column", gap: 2,
                  }}
                >
                  <button
                    onClick={() => { setUserMenuOpen(false); window.location.assign("/change-password"); }}
                    style={{
                      all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 9,
                      padding: "9px 10px", borderRadius: 6, fontSize: 13.5, color: "var(--ink-2)",
                    }}
                  >
                    <IconKey size={16} />修改密码
                  </button>
                  <button
                    onClick={() => { setUserMenuOpen(false); void onLogout(); }}
                    style={{
                      all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 9,
                      padding: "9px 10px", borderRadius: 6, fontSize: 13.5, color: "var(--bad)",
                    }}
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
