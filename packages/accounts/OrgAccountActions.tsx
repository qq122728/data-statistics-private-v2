"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

export type OrgManagedAccount = {
  id: string;
  name: string;
  username: string;
  active: boolean;
  updatedAt?: string;
};

type DialogKind = "reset" | "toggle" | "delete" | null;

const modalButtonStyle = {
  minHeight: 34, border: "1px solid var(--line, #cfd6e2)", borderRadius: 6,
  background: "var(--surface, #fff)", padding: "0 14px", cursor: "pointer",
} satisfies CSSProperties;
const primaryButtonStyle = {
  ...modalButtonStyle, borderColor: "var(--accent, #1a73e8)",
  background: "var(--accent, #1a73e8)", color: "#fff", fontWeight: 650,
} satisfies CSSProperties;

function temporaryPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  const bytes = new Uint32Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new Error("无法连接服务器，请检查网络后重试");
  }
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "操作失败，请稍后重试");
  return payload;
}

export default function OrgAccountActions({
  account,
  transferAction,
  allowPermanentDelete = false,
  disabled = false,
  className,
  adminButtons = false,
  onChanged,
  onDeleted,
  notify,
}: {
  account: OrgManagedAccount;
  transferAction?: ReactNode;
  allowPermanentDelete?: boolean;
  disabled?: boolean;
  className?: string;
  adminButtons?: boolean;
  onChanged: (account: OrgManagedAccount) => void;
  onDeleted?: (id: string) => void;
  notify: (message: string, tone?: "ok" | "warn") => void;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const buttonProps = adminButtons ? { className: "btn", "data-size": "sm" } : {};

  function open(kind: Exclude<DialogKind, null>) {
    setError("");
    setSaved(false);
    if (kind === "reset") setPassword(temporaryPassword());
    setDialog(kind);
  }

  function close() {
    if (busy) return;
    setDialog(null);
    setError("");
  }

  async function reset() {
    setBusy(true); setError("");
    try {
      await requestJson("/api/org/accounts", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: account.id, password }),
      });
      setSaved(true);
      onChanged({ ...account, updatedAt: new Date().toISOString() });
      notify(`${account.name}的临时密码已重置，请先保存临时密码`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密码重置失败");
    } finally { setBusy(false); }
  }

  async function toggle() {
    setBusy(true); setError("");
    try {
      const result = await requestJson<{ id: string; active: boolean }>("/api/org/accounts", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: account.id, active: !account.active }),
      });
      onChanged({ ...account, active: result.active, updatedAt: new Date().toISOString() });
      notify(`${account.name}的账号已${result.active ? "恢复" : "停用"}，历史数据保持不变`);
      setDialog(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号状态修改失败");
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError("");
    try {
      await requestJson("/api/org/accounts", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: account.id }),
      });
      onDeleted?.(account.id);
      notify(`已永久删除误开账号“${account.name}”`);
      setDialog(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号删除失败");
    } finally { setBusy(false); }
  }

  return <>
    <div className={className} style={adminButtons ? { display: "flex", gap: 6, flexWrap: "wrap" } : undefined}>
      {transferAction}
      <button {...buttonProps} type="button" disabled={disabled || busy} aria-label={`重置 ${account.name} 的密码`} onClick={() => open("reset")}>重置密码</button>
      <button {...buttonProps} type="button" disabled={disabled || busy} data-danger={account.active || undefined} style={adminButtons ? { color: account.active ? "var(--bad)" : "#137333" } : undefined} onClick={() => account.active ? open("toggle") : void toggle()}>{account.active ? "停用账号" : "恢复账号"}</button>
      {allowPermanentDelete ? <button {...buttonProps} type="button" disabled={disabled || busy} style={adminButtons ? { color: "var(--bad)" } : undefined} onClick={() => open("delete")}>永久删除</button> : null}
    </div>
    {dialog ? <div role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()} style={{ position: "fixed", inset: 0, zIndex: 1300, display: "grid", placeItems: "center", padding: 20, background: "rgba(19,24,36,.42)" }}>
      <section role="dialog" aria-modal="true" aria-label={dialog === "reset" ? "重置账号密码" : dialog === "toggle" ? "确认停用账号" : "确认永久删除账号"} style={{ width: "min(480px,96vw)", padding: 22, display: "grid", gap: 14, background: "var(--surface, #fff)", border: "1px solid var(--line, #d9e0ea)", borderRadius: 12, boxShadow: "0 20px 50px rgba(19,24,36,.22)", color: "var(--ink, #202938)" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{dialog === "reset" ? `重置密码 · ${account.name}` : dialog === "toggle" ? `停用账号 · ${account.name}` : `永久删除账号 · ${account.name}`}</h2>
        <p style={{ margin: 0, color: "var(--ink-3, #667085)", fontSize: 13, lineHeight: 1.6 }}>登录账号：<strong>{account.username}</strong></p>
        {dialog === "reset" ? <label style={{ display: "grid", gap: 6, fontSize: 13 }}><span>新临时密码</span><span style={{ display: "flex", gap: 8 }}><input aria-label="新临时密码" readOnly value={password} style={{ flex: 1, minWidth: 0, height: 38, border: "1px solid var(--line, #cfd6e2)", borderRadius: 6, padding: "0 10px" }} /><button {...buttonProps} style={modalButtonStyle} type="button" disabled={busy || saved} onClick={() => setPassword(temporaryPassword())}>重新生成</button></span></label> : null}
        {dialog === "toggle" ? <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>停用后不能登录或修改数据，当前登录立即失效；历史客户、业绩和操作记录全部保留。</p> : null}
        {dialog === "delete" ? <p style={{ margin: 0, color: "var(--bad, #b42318)", fontSize: 13, lineHeight: 1.6 }}>只用于清理误开的空账号。删除后无法恢复；账号只要已有业务或操作记录，系统就会拒绝删除。</p> : null}
        {error ? <p role="alert" style={{ margin: 0, color: "var(--bad, #b42318)", fontSize: 13 }}>{error}</p> : null}
        {dialog === "reset" ? <p style={{ margin: 0, color: "var(--ink-3, #667085)", fontSize: 13 }}>{saved ? "密码已经重置。请先保存上面的临时密码，再关闭窗口。" : "确认后旧密码和当前登录都会失效；对方首次登录必须设置自己的新密码。"}</p> : null}
        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button {...buttonProps} style={modalButtonStyle} type="button" disabled={busy} onClick={close}>{saved ? "关闭" : "取消"}</button>
          {dialog === "reset" ? <button {...buttonProps} style={primaryButtonStyle} type="button" disabled={busy || saved} onClick={() => void reset()}>{busy ? "重置中…" : saved ? "已重置" : "确认重置"}</button> : null}
          {dialog === "toggle" ? <button {...buttonProps} type="button" disabled={busy} style={{ ...modalButtonStyle, color: "var(--bad, #b42318)" }} onClick={() => void toggle()}>{busy ? "停用中…" : "确认停用"}</button> : null}
          {dialog === "delete" ? <button {...buttonProps} type="button" disabled={busy} style={{ ...primaryButtonStyle, borderColor: "var(--bad, #b42318)", background: "var(--bad, #b42318)" }} onClick={() => void remove()}>{busy ? "删除中…" : "确认永久删除"}</button> : null}
        </footer>
      </section>
    </div> : null}
  </>;
}
