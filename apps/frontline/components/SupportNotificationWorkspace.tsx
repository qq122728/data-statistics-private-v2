"use client";

import type { BackendUser } from "@/lib/backend";
import { NotificationBadge, UnifiedNotificationCenter, useNotificationUnread } from "@/components/UnifiedNotificationCenter";
import { WorkspaceNavButton, WorkspaceShell } from "@/components/WorkspaceShell";

const roleCopy = {
  FINANCE: { title: "财务通知工作台", label: "财务", description: "接收与财务工作有关的系统通知，可标记已读并确认重要通知。" },
  HR: { title: "人事通知工作台", label: "人事", description: "接收与人员、考勤和组织调整有关的系统通知。" },
} as const;

export default function SupportNotificationWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  const [unread, setUnread] = useNotificationUnread();
  const copy = roleCopy[user.role === "HR" ? "HR" : "FINANCE"];

  return <WorkspaceShell mark={copy.label.slice(0, 1)} workspaceLabel={`${copy.label}工作台`} title={copy.title} subtitle={copy.description} userName={user.name} userLabel={`${copy.label}账号 · 只读通知权限`} onLogout={onLogout} navigation={<WorkspaceNavButton active icon="notifications" onClick={() => undefined}>通知中心<NotificationBadge count={unread} /></WorkspaceNavButton>}>
        <section className="fresh-sheet-card" style={{ marginBottom: 14, padding: "14px 16px" }}>
          <strong>只读通知权限</strong>
          <p style={{ margin: "4px 0 0", color: "#7a879a", fontSize: 12 }}>这个账号可以查看、标记已读和确认重要通知，不能向其他人发布通知。</p>
        </section>
        <UnifiedNotificationCenter onUnreadChange={setUnread} />
  </WorkspaceShell>;
}
