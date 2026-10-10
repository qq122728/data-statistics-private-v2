"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { requestJson, workspaceOrigin, type BackendUser } from "@/lib/backend";
import { resolveFrontlineEntry } from "@/lib/frontline-entry";
import "./fresh.css";
import "./inspector.css";
import "./analysis.css";
import "./daily-report.css";
import "./department.css";
import "./department-management.css";
import "./ui-polish.css";

const FreshWorkspace = dynamic(() => import("@/components/FreshWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在打开共享表格…</main>,
});
const DepartmentWorkspace = dynamic(() => import("@/components/DepartmentWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在打开部门工作台…</main>,
});
const CompanyWorkspace = dynamic(() => import("@/components/CompanyWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在打开公司工作台…</main>,
});
const HeadquartersWorkspace = dynamic(() => import("@/components/HeadquartersWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在打开总公司工作台…</main>,
});
const ResourceWorkspace = dynamic(() => import("@/components/ResourceWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在打开资源工作台…</main>,
});
const FinanceWorkspace = dynamic(() => import("@/components/FinanceWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在打开财务工作台…</main>,
});
const SupportNotificationWorkspace = dynamic(() => import("@/components/SupportNotificationWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在打开通知工作台…</main>,
});

export default function Page() {
  const [user, setUser] = useState<BackendUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ user: BackendUser }>("/api/auth/me")
      .then(({ user: current }) => {
        if (cancelled) return;
        // 旧会话偶尔只带主岗位、不带完整岗位列表。把主岗位合并进去，
        // 才不会让财务等管理账号误落到默认工作台。
        const normalized = { ...current, roles: [...new Set([...(current.roles ?? []), current.role])] };
        if (
          normalized.role === "ADMIN"
          || ["DEPARTMENT_MANAGER", "COMPANY_MANAGER", "HQ_MANAGER"].includes(normalized.duty ?? "")
          || normalized.roles.some((role) => ["ADMIN", "RESOURCE_MANAGER", "FINANCE", "HR"].includes(role))
        ) {
          setUser(normalized);
          return;
        }
        const entry = resolveFrontlineEntry(normalized.roles, normalized.groupId);
        if (entry.workspace === "ADMIN") {
          window.location.replace(workspaceOrigin("ADMIN"));
          return;
        }
        setUser(normalized);
      })
      .catch(() => window.location.assign("/login"))
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  if (!ready || !user) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#667085" }}>正在读取登录身份…</main>;
  if (user.role === "ADMIN" || user.duty === "HQ_MANAGER") return <HeadquartersWorkspace user={user} onLogout={logout} />;
  if (user.duty === "COMPANY_MANAGER") return <CompanyWorkspace user={user} onLogout={logout} />;
  if (user.duty === "DEPARTMENT_MANAGER") return <DepartmentWorkspace user={user} onLogout={logout} />;
  // 主岗位为财务时必须优先进入财务工作台；即使旧会话残留了资源部兼任岗位，
  // 也不能把财务账号错误显示为资源部账号。
  if (user.role === "FINANCE" || (user.roles.includes("FINANCE") && !user.roles.includes("RESOURCE_MANAGER"))) return <FinanceWorkspace user={user} onLogout={logout} />;
  if (user.roles.includes("RESOURCE_MANAGER")) return <ResourceWorkspace user={user} onLogout={logout} />;
  if (user.roles.includes("HR")) return <SupportNotificationWorkspace user={user} onLogout={logout} />;
  return <FreshWorkspace user={user} onLogout={logout} />;
}
