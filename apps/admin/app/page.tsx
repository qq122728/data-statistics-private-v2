"use client";

import { useEffect, useState } from "react";
import { AppShell, type Role } from "@/components/AppShell";
import { ConfirmDialog, type Confirm } from "@/components/ConfirmDialog";
import { DailyDataWorkbench } from "@/components/DailyDataWorkbench";
import { IconAlert, IconCheck } from "@/components/Icons";
import { Leaderboard } from "@/components/Leaderboard";
import { ManagementCustomerProgress } from "@/components/ManagementCustomerProgress";
import { OrganizationDetailWorkspace } from "@/components/OrganizationDetailWorkspace";
import { RealChannelReporting } from "@/components/RealChannelReporting";
import { RealCustomerProgress } from "@/components/RealCustomerProgress";
import { RealGroupDeviceManagement } from "@/components/RealGroupDeviceManagement";
import { RealHierarchyOverview } from "@/components/RealHierarchyOverview";
import { RealNotificationCenter } from "@/components/RealNotificationCenter";
import { RealOrganizationManagement } from "@/components/RealOrganizationManagement";
import { PersonnelTransferPanel } from "@/components/PersonnelTransferPanel";
import { RealOrganizationReporting } from "@/components/RealOrganizationReporting";
import { RealResourceDailyStatReview } from "@/components/RealResourceDailyStatReview";
import { RealResourceReporting } from "@/components/RealResourceReporting";
import { RealChannelSettings } from "@/components/RealChannelSettings";
import { TabDashboard } from "@/components/TabDashboard";
import { TabMembers } from "@/components/TabMembers";
import {
  generateSecureTemporaryPassword,
  requestJson,
  toMember,
  workspaceOrigin,
  type BackendUser,
  type LeadMemberResponse,
  type Member,
  type Position,
} from "@/lib/backend";

type View =
  | "members" | "followup" | "expert-daily" | "summary" | "channel" | "dashboard" | "notice" | "devices" | "leaderboard"
  | "team-overview" | "team-detail" | "group-leadership" | "dept-notice" | "dept-leaderboard"
  | "company-overview" | "company-detail" | "company-leadership" | "company-notice" | "company-leaderboard"
  | "hq-overview" | "hq-detail" | "hq-leadership" | "hq-notice" | "hq-leaderboard"
  | "resource-inbox" | "resource-summary" | "resource-group-detail" | "resource-notice"
  | "management-customer-progress" | "channel-settings";

const DEFAULT_VIEW: Record<Role, View> = {
  LEAD: "followup",
  DEPT_MANAGER: "team-overview",
  COMPANY_MANAGER: "company-overview",
  HQ_MANAGER: "hq-overview",
  RESOURCE_TRAFFIC: "resource-inbox",
  RESOURCE_SMS: "resource-inbox",
};

const PAGE_META: Record<View, { title: string; section: string }> = {
  members: { title: "组员管理", section: "我的数据" },
  followup: { title: "客户进度工作台", section: "日常工作" },
  "expert-daily": { title: "每日数据填写", section: "日常工作" },
  summary: { title: "数据汇总", section: "日常工作" },
  channel: { title: "渠道数据核对", section: "日常工作" },
  dashboard: { title: "我的看板", section: "我的数据" },
  notice: { title: "通知中心", section: "日常工作" },
  devices: { title: "设备管理", section: "我的数据" },
  leaderboard: { title: "精英榜", section: "我的数据" },
  "team-overview": { title: "团队汇总", section: "日常工作" },
  "team-detail": { title: "组内明细", section: "日常工作" },
  "group-leadership": { title: "组长与人事", section: "组织管理" },
  "dept-notice": { title: "通知中心", section: "日常工作" },
  "dept-leaderboard": { title: "精英榜", section: "组织管理" },
  "company-overview": { title: "部门汇总", section: "日常工作" },
  "company-detail": { title: "部门明细", section: "日常工作" },
  "company-leadership": { title: "部门与组长人事", section: "组织管理" },
  "company-notice": { title: "通知中心", section: "日常工作" },
  "company-leaderboard": { title: "精英榜", section: "组织管理" },
  "hq-overview": { title: "公司汇总", section: "日常工作" },
  "hq-detail": { title: "公司明细", section: "日常工作" },
  "hq-leadership": { title: "全局人事", section: "组织管理" },
  "hq-notice": { title: "通知中心", section: "日常工作" },
  "hq-leaderboard": { title: "精英榜", section: "组织管理" },
  "resource-inbox": { title: "接粉数据核对", section: "日常工作" },
  "resource-summary": { title: "渠道数据汇总", section: "日常工作" },
  "resource-group-detail": { title: "小组明细", section: "日常工作" },
  "resource-notice": { title: "通知中心", section: "日常工作" },
  "management-customer-progress": { title: "客户进度", section: "日常工作" },
  "channel-settings": { title: "渠道设置", section: "组织管理" },
};

function roleForUser(user: BackendUser): Role | null {
  if (user.role === "ADMIN") return "HQ_MANAGER";
  if (user.duty === "HQ_MANAGER") return "HQ_MANAGER";
  if (user.duty === "COMPANY_MANAGER") return "COMPANY_MANAGER";
  if (user.duty === "DEPARTMENT_MANAGER") return "DEPT_MANAGER";
  if (user.role === "RESOURCE_MANAGER") {
    const hasSms = user.resourceChannelTypes?.includes("SMS") ?? false;
    const hasAds = user.resourceChannelTypes?.includes("ADS") ?? false;
    if (hasSms && !hasAds) return "RESOURCE_SMS";
    if (hasAds && !hasSms) return "RESOURCE_TRAFFIC";
    // 没授权或同时混入两种渠道时必须失败关闭，不能把短信账号误装成投流账号。
    return null;
  }
  if (user.roles.includes("LEAD")) return "LEAD";
  return null;
}

function isFrontlineOnly(user: BackendUser): boolean {
  return !user.duty
    && !user.roles.includes("LEAD")
    && user.roles.some((role) => ["RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role));
}

function scopeLabel(user: BackendUser, role: Role): string {
  if (role === "HQ_MANAGER") return "总公司";
  if (role === "COMPANY_MANAGER") return user.companyName ?? "所属公司";
  if (role === "DEPT_MANAGER") return user.departmentName ?? "所属部门";
  if (role === "RESOURCE_SMS") return "短信渠道";
  if (role === "RESOURCE_TRAFFIC") return "投流渠道";
  return user.groupName ?? "所属小组";
}

function roleTitle(user: BackendUser, role: Role): string {
  if (role === "HQ_MANAGER") return "总公司管理员";
  if (role === "COMPANY_MANAGER") return "公司管理员";
  if (role === "DEPT_MANAGER") return "部门管理员";
  if (role === "RESOURCE_SMS") return "资源部·短信";
  if (role === "RESOURCE_TRAFFIC") return "资源部·投流";
  return user.roles.includes("LEAD") ? "组长" : "管理账号";
}

export default function Page() {
  const [sessionUser, setSessionUser] = useState<BackendUser | null | undefined>(undefined);
  const [role, setRole] = useState<Role>("LEAD");
  const [view, setView] = useState<View>("followup");
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "ok" | "warn" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ user: BackendUser }>("/api/auth/me")
      .then(({ user }) => {
        if (cancelled) return;
        const nextRole = roleForUser(user);
        if (nextRole) {
          setSessionUser(user);
          setRole(nextRole);
          setView(DEFAULT_VIEW[nextRole]);
        } else if (isFrontlineOnly(user)) {
          window.location.assign(workspaceOrigin("FRONTLINE"));
        } else {
          setSessionUser(user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionUser(null);
          window.location.assign("/login");
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadLeadWorkspace() {
    setMembersLoading(true);
    setMembersError("");
    try {
      const [memberRows, collaboration] = await Promise.all([
        requestJson<LeadMemberResponse[]>("/api/lead/members"),
        requestJson<{ assignments: Array<{ groupOperatorId: string; receptionistId: string }> }>("/api/lead/collaborations"),
      ]);
      const pairings = new Map(collaboration.assignments.map((item) => [item.receptionistId, item.groupOperatorId]));
      setMembers(memberRows.map((member) => toMember(member, pairings)));
    } catch (caught) {
      setMembersError(caught instanceof Error ? caught.message : "真实组员数据加载失败");
    } finally {
      setMembersLoading(false);
    }
  }

  useEffect(() => {
    if (sessionUser && roleForUser(sessionUser) === "LEAD") void loadLeadWorkspace();
  }, [sessionUser]);

  function showToast(msg: string, tone: "ok" | "warn" = "ok") {
    setToast({ msg, tone });
  }

  function rolePayload(positions: Position[]) {
    const primary = positions.includes("RECEPTION") ? "RECEPTION" : positions.includes("GROUP_OPERATOR") ? "GROUP_OPERATOR" : "EXPERT";
    return { role: primary, secondaryRoles: positions.filter((position) => position !== primary) };
  }

  async function updateMemberSetup(memberId: string, positions: Position[], pairedGroupOperatorId: string | null, profile: { name: string; username: string }) {
    const member = members.find((item) => item.id === memberId);
    const current = member?.positions ?? [];
    if (current.some((position) => !positions.includes(position)))
      throw new Error("已有岗位不能在这里关闭；请使用“人员调岗与跨组调动”");
    const primaryPosition = member?.primaryPosition ?? current[0];
    if (!primaryPosition) throw new Error("成员当前岗位不完整，请刷新后重试");
    await requestJson("/api/lead/members", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: memberId, pairedGroupOperatorId, name: profile.name, username: profile.username, secondaryRoles: positions.filter((position) => position !== primaryPosition) }),
    });
    await loadLeadWorkspace();
    setConfirm(null);
  }

  async function createAccount(draft: { name: string; username: string; positions: Position[]; pairedGroupOperatorId?: string }): Promise<string> {
    const password = generateSecureTemporaryPassword();
    await requestJson("/api/lead/members", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draft, password, ...rolePayload(draft.positions), pairedGroupOperatorId: draft.pairedGroupOperatorId ?? null }),
    });
    await loadLeadWorkspace();
    setConfirm(null);
    return password;
  }

  async function resetPassword(memberId: string): Promise<string> {
    const password = generateSecureTemporaryPassword();
    await requestJson("/api/lead/members", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: memberId, password }),
    });
    await loadLeadWorkspace();
    setConfirm(null);
    return password;
  }

  async function deleteAccount(memberId: string): Promise<void> {
    await requestJson("/api/lead/members", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: memberId }),
    });
    await loadLeadWorkspace();
    setConfirm(null);
  }

  async function previewHandoff(draft: { receptionistId: string; fromGroupOperatorId: string; toGroupOperatorId: string }) {
    return (await requestJson<{ count: number }>("/api/lead/collaborations/handoff", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "preview", ...draft }),
    })).count;
  }

  async function confirmHandoff(draft: { receptionistId: string; fromGroupOperatorId: string; toGroupOperatorId: string; expectedCount: number; reason: string }) {
    return (await requestJson<{ transferredCount: number }>("/api/lead/collaborations/handoff", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "confirm", ...draft }),
    })).transferredCount;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  if (sessionUser === undefined || sessionUser === null) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--ink-3)" }}>正在读取真实登录状态…</main>;
  }
  const authenticatedRole = roleForUser(sessionUser);
  if (!authenticatedRole) {
    const resourceMessage = sessionUser.role === "RESOURCE_MANAGER" ? "这个资源部账号尚未配置唯一的渠道类型（投流或短信），请联系总公司管理员配置后再登录。" : "请使用组长、部门管理员、公司管理员、总公司管理员或已配置渠道的资源部账号。";
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}><section className="card" style={{ maxWidth: 560, padding: 28 }}><h1 style={{ marginTop: 0 }}>这个账号暂时没有管理工作台</h1><p style={{ color: "var(--ink-2)" }}>当前登录：{sessionUser.name}（{sessionUser.role}）。{resourceMessage}</p><button className="btn" data-variant="primary" onClick={() => void logout()}>退出并更换账号</button></section></main>;
  }

  const meta = PAGE_META[view];
  const scope = scopeLabel(sessionUser, role);
  const breadcrumb = `${meta.section} / ${scope}`;
  const managementPermission = role === "DEPT_MANAGER" ? "只读 · 部门范围" : role === "COMPANY_MANAGER" ? "只读 · 公司范围" : "只读 · 总公司范围";

  return (
    <AppShell
      role={role}
      active={view}
      title={meta.title}
      breadcrumb={breadcrumb}
      reviewPendingCount={0}
      onNavigate={(id) => setView(id as View)}
      viewer={{ name: sessionUser.name, title: roleTitle(sessionUser, role), scope }}
      onLogout={logout}
      onToast={showToast}
    >
      {view === "followup" ? <RealCustomerProgress members={members} readOnly expertActorId={sessionUser.id} />
        : view === "expert-daily" ? <DailyDataWorkbench />
        : view === "summary" ? <RealOrganizationReporting permissionLabel="本组管理" actorGroupMode />
          : view === "channel" ? <RealChannelReporting />
            : view === "members" ? <>
              {membersLoading ? <div className="card" style={{ padding: 16, marginBottom: 14, color: "var(--ink-3)" }}>正在读取真实组员与配对数据…</div> : null}
              {membersError ? <div className="card" style={{ padding: 16, marginBottom: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{membersError}<button className="btn" data-size="sm" style={{ marginLeft: 12 }} onClick={() => void loadLeadWorkspace()}>重试</button></div> : null}
              <TabMembers members={members} transfers={[]} onUpdateMemberSetup={updateMemberSetup} onCreateAccount={createAccount} onResetPassword={resetPassword} onDeleteAccount={deleteAccount} onPreviewHandoff={previewHandoff} onConfirmHandoff={confirmHandoff} onToast={showToast} onConfirm={setConfirm} />
              <PersonnelTransferPanel onToast={showToast} />
            </>
              : view === "devices" ? <RealGroupDeviceManagement members={members} />
                : view === "dashboard" ? <TabDashboard />
                    : ["group-leadership", "company-leadership", "hq-leadership"].includes(view) ? <RealOrganizationManagement duty={role === "HQ_MANAGER" ? "HQ_MANAGER" : sessionUser.duty as "DEPARTMENT_MANAGER" | "COMPANY_MANAGER"} onToast={showToast} />
                      : view === "channel-settings" ? <RealChannelSettings />
                      : view === "team-detail" ? <OrganizationDetailWorkspace scope="department" />
                        : view === "team-overview" ? <RealHierarchyOverview level="group" title="团队汇总" />
                          : view === "company-detail" ? <OrganizationDetailWorkspace scope="company" />
                            : view === "company-overview" ? <RealHierarchyOverview level="department" title="部门汇总" fixedMonth />
                              : view === "hq-detail" ? <OrganizationDetailWorkspace scope="hq" />
                                : view === "hq-overview" ? <RealHierarchyOverview level="company" title="公司汇总" fixedMonth />
                                  : view === "management-customer-progress" ? <ManagementCustomerProgress permissionLabel={managementPermission} />
                                    : view === "resource-summary" ? <RealResourceReporting detail={false} />
                                      : view === "resource-inbox" ? <RealResourceDailyStatReview />
                                        : view === "resource-group-detail" ? <RealResourceReporting detail />
                                          : ["leaderboard", "dept-leaderboard", "company-leaderboard", "hq-leaderboard"].includes(view) ? <Leaderboard />
                                            : ["notice", "dept-notice", "company-notice", "hq-notice"].includes(view) ? <RealNotificationCenter canSend />
                                              : view === "resource-notice" ? <RealNotificationCenter canSend={false} />
                                                : null}

      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      {toast ? <div role="status" style={{
        position: "fixed", right: 24, bottom: 24, zIndex: 50, display: "flex", alignItems: "center", gap: 10,
        padding: "13px 18px", borderRadius: "var(--radius)", background: toast.tone === "warn" ? "var(--warn-soft)" : "var(--ok-soft)",
        border: `1px solid ${toast.tone === "warn" ? "var(--warn-line)" : "var(--ok-line)"}`,
        color: toast.tone === "warn" ? "var(--warn)" : "var(--ok)", boxShadow: "0 6px 20px rgba(19,24,36,.10)", fontSize: 14, fontWeight: 600,
      }}>{toast.tone === "warn" ? <IconAlert size={18} /> : <IconCheck size={18} />}{toast.msg}</div> : null}
    </AppShell>
  );
}
