"use client";

import { useState, type FormEvent } from "react";
import { IconChart } from "@/components/Icons";
import { workspaceOrigin, type LoginResponse } from "@/lib/backend";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<LoginResponse> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "登录失败，请稍后再试");
      if (payload.mustChangePassword) {
        window.location.assign("/change-password");
      } else {
        window.location.assign(workspaceOrigin(payload.workspace ?? "ADMIN"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
    <section className="card" style={{ width: "100%", maxWidth: 420, padding: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <span style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--accent)", color: "white" }}><IconChart size={21} /></span>
        <div><h1 style={{ margin: 0, fontSize: 20 }}>数据统计管理端</h1><p style={{ margin: 0, color: "var(--ink-3)", fontSize: 13 }}>使用真实系统账号登录</p></div>
      </div>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label><span className="label">账号</span><input className="field" name="username" autoComplete="username" required autoFocus style={{ width: "100%" }} /></label>
        <label><span className="label">密码</span><input className="field" name="password" type="password" autoComplete="current-password" required style={{ width: "100%" }} /></label>
        {error ? <p role="alert" style={{ margin: 0, padding: "9px 12px", borderRadius: 8, color: "var(--bad)", background: "var(--bad-soft)", border: "1px solid var(--bad-line)" }}>{error}</p> : null}
        <button className="btn" data-variant="primary" disabled={busy} style={{ justifyContent: "center", height: 40 }}>{busy ? "正在登录…" : "登录"}</button>
      </form>
      <p style={{ margin: "18px 0 0", color: "var(--ink-3)", fontSize: 12.5 }}>登录后系统会按真实岗位自动进入一线端或管理端，不需要自己选择入口。</p>
    </section>
  </main>;
}
