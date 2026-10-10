"use client";

import { useState, type FormEvent } from "react";
import CredentialForm from "./CredentialForm";

export function ChangePasswordForm({ loginHref, cancelHref }: { loginHref: string; cancelHref: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmPassword") ?? "")) {
      setError("两次填写的新密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "修改密码失败");
      window.location.replace(loginHref);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "修改密码失败");
    } finally {
      setBusy(false);
    }
  }

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
    <section className="card" style={{ width: "100%", maxWidth: 440, padding: 28 }}>
      <h1 style={{ marginTop: 0 }}>修改密码</h1>
      <p style={{ color: "var(--ink-3)" }}>新密码至少 6 位。保存后全部旧登录会失效，需要重新登录。</p>
      <CredentialForm action="/api/auth/change-password" busy={busy} onSubmit={submit} gap={12}>
        <label><span className="label">当前密码</span><input className="field" style={{ width: "100%" }} type="password" name="currentPassword" autoComplete="current-password" required /></label>
        <label><span className="label">新密码</span><input className="field" style={{ width: "100%" }} type="password" name="newPassword" autoComplete="new-password" minLength={6} required /></label>
        <label><span className="label">再次填写新密码</span><input className="field" style={{ width: "100%" }} type="password" name="confirmPassword" autoComplete="new-password" minLength={6} required /></label>
        {error ? <p role="alert" style={{ color: "var(--bad)", margin: 0 }}>{error}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={() => window.location.assign(cancelHref)}>取消，返回工作台</button>
          <button type="submit" className="btn" data-variant="primary" disabled={busy}>{busy ? "正在保存…" : "保存新密码"}</button>
        </div>
      </CredentialForm>
    </section>
  </main>;
}
