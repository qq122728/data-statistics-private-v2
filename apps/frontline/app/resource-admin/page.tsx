"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { BackendUser } from "@/lib/backend";
import { readResourceAdminSession } from "@/lib/resource-admin-session";

const ResourceAdminWorkspace = dynamic(() => import("@/components/ResourceAdminWorkspace"), {
  ssr: false,
  loading: () => <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>正在打开资源后台…</main>,
});

export default function ResourceAdminPage() {
  const [user, setUser] = useState<BackendUser | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    void readResourceAdminSession()
      .then((result) => {
        if (cancelled) return;
        if (result.kind === "login" || result.kind === "home") {
          window.location.replace(result.kind === "login" ? "/login" : "/");
          return;
        }
        if (result.kind === "error") setError(result.message);
        else setUser(result.user);
      })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  if (error) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><section style={{ textAlign: "center" }}><p role="alert">{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载</button><p><a href="/">返回工作台</a></p></section></main>;
  if (!ready || !user) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>正在读取登录身份…</main>;
  return <ResourceAdminWorkspace user={user} onLogout={logout} />;
}
