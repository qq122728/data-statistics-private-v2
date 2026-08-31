"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DailyDataWorkbench } from "@/components/DailyDataWorkbench";
import { DeviceAccounts } from "@/components/DeviceAccounts";
import { ExpertWorkbench } from "@/components/ExpertWorkbench";
import { GroupOperatorWorkbench } from "@/components/GroupOperatorWorkbench";
import { IconAlert, IconCheck, IconInbox, IconRoute, IconUpload } from "@/components/Icons";
import { Leaderboard } from "@/components/Leaderboard";
import { MyPerformance } from "@/components/MyPerformance";
import { RealNotificationCenter } from "@/components/RealNotificationCenter";
import { RealReceptionFollowUp } from "@/components/RealReceptionFollowUp";
import { RealReceptionProgress } from "@/components/RealReceptionProgress";
import { TabImport } from "@/components/TabImport";
import { requestJson, workspaceOrigin, type BackendUser } from "@/lib/backend";
import { resolveFrontlineEntry, WORK_ROLES, type WorkRole } from "@/lib/frontline-entry";

type TabId = "followUp" | "import" | "downstream";
type View = "customerProgress" | "dailyData" | "notice" | "device" | "mine" | "rank";

const TABS: Array<{ id: TabId; label: string; Icon: typeof IconInbox }> = [
  { id: "import", label: "号码导入", Icon: IconUpload },
  { id: "followUp", label: "客户回复管理", Icon: IconInbox },
  { id: "downstream", label: "客户进度", Icon: IconRoute },
];
const WORK_ROLE_LABEL: Record<WorkRole, string> = { RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家" };
const PAGE_META: Record<View, string> = {
  customerProgress: "客户进度工作台", dailyData: "每日数据填写",
  notice: "通知中心", device: "设备账号", mine: "我的业绩", rank: "精英榜",
};

export default function Page() {
  const [sessionUser, setSessionUser] = useState<BackendUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState<View>("customerProgress");
  const [workRole, setWorkRole] = useState<WorkRole>("RECEPTION");
  const [tab, setTab] = useState<TabId>("followUp");
  const [replyCount, setReplyCount] = useState(0);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ user: BackendUser }>("/api/auth/me")
      .then(({ user }) => {
        if (cancelled) return;
        const entry = resolveFrontlineEntry(user.roles, user.groupId);
        if (entry.workspace === "ADMIN") {
          window.location.replace(workspaceOrigin("ADMIN"));
          return;
        }
        setSessionUser(user);
        setWorkRole(entry.role);
      })
      .catch(() => window.location.assign("/login"))
      .finally(() => { if (!cancelled) setAuthReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  if (!authReady || !sessionUser) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>正在读取登录身份…</main>;
  }

  const availableWorkRoles = WORK_ROLES.filter((role) => sessionUser.roles.includes(role));
  const showToast = (msg: string, tone: "ok" | "warn" = "ok") => setToast({ msg, tone });
  const pageTitle = PAGE_META[view];

  return (
    <AppShell
      active={view}
      title={pageTitle}
      breadcrumb={`数据统计 / ${pageTitle}`}
      onNavigate={(id) => setView(id as View)}
      viewer={{
        name: sessionUser.name,
        title: WORK_ROLE_LABEL[workRole],
        scope: sessionUser.groupName ?? "未分组",
        timezoneLabel: `${sessionUser.departmentName ?? "当地"}时间 · 按小组时区`,
      }}
      onLogout={logout}
    >
      {view === "customerProgress" ? (
        <>
          <section className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>当前处理身份</strong>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>同一个账号按授权岗位处理同一份真实客户通讯录；切换身份不会复制客户。</div>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {availableWorkRoles.map((role) => (
                  <button key={role} className="btn" data-variant={workRole === role ? "primary" : undefined} onClick={() => setWorkRole(role)}>
                    {WORK_ROLE_LABEL[role]}权限
                  </button>
                ))}
              </div>
            </div>
          </section>

          {workRole === "RECEPTION" ? (
            <>
              <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid var(--line)" }}>
                {TABS.map(({ id, label, Icon }) => {
                  const active = tab === id;
                  const badge = id === "followUp" && replyCount > 0 ? replyCount : null;
                  return (
                    <button key={id} onClick={() => setTab(id)} style={{
                      display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px", marginBottom: -1,
                      border: "none", borderBottom: `2.5px solid ${active ? "var(--accent)" : "transparent"}`,
                      background: "transparent", color: active ? "var(--accent)" : "var(--ink-2)",
                      fontSize: 14.5, fontWeight: 600, cursor: "pointer",
                    }}>
                      <Icon size={18} />{label}
                      {badge ? <span className="badge" data-tone="bad">{badge}</span> : null}
                    </button>
                  );
                })}
              </div>
              {tab === "followUp" ? <RealReceptionFollowUp onReplyCountChange={setReplyCount} /> : null}
              {tab === "import" ? <TabImport onToast={showToast} /> : null}
              {tab === "downstream" ? <RealReceptionProgress /> : null}
            </>
          ) : workRole === "GROUP_OPERATOR" ? <GroupOperatorWorkbench /> : <ExpertWorkbench />}
        </>
      ) : view === "dailyData" ? <DailyDataWorkbench />
        : view === "notice" ? <RealNotificationCenter />
          : view === "device" ? <DeviceAccounts />
            : view === "mine" ? <MyPerformance role={workRole} />
              : <Leaderboard />}

      {toast ? (
        <div role="status" style={{
          position: "fixed", right: 24, bottom: 24, zIndex: 50, display: "flex", alignItems: "center", gap: 10,
          padding: "13px 18px", borderRadius: "var(--radius)",
          background: toast.tone === "warn" ? "var(--warn-soft)" : "var(--ok-soft)",
          border: `1px solid ${toast.tone === "warn" ? "var(--warn-line)" : "var(--ok-line)"}`,
          color: toast.tone === "warn" ? "var(--warn)" : "var(--ok)", boxShadow: "0 6px 20px rgba(19,24,36,.10)",
          fontSize: 14, fontWeight: 600,
        }}>
          {toast.tone === "warn" ? <IconAlert size={18} /> : <IconCheck size={18} />}{toast.msg}
        </div>
      ) : null}
    </AppShell>
  );
}
