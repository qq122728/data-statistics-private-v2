"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./AccountMenu.module.css";

export function AccountMenu({ name, roleLabel, scope, changePasswordHref, onLogout }: {
  name: string;
  roleLabel: string;
  scope: ReactNode;
  changePasswordHref: string;
  onLogout: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const id = useId();

  function close(restoreFocus = true) {
    if (submitting.current) return;
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 16);
      const height = menu.current?.offsetHeight ?? 112;
      const below = window.innerHeight - rect.bottom - 8;
      const top = below >= height ? rect.bottom + 6 : Math.max(8, rect.top - height - 6);
      setPosition({ top, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), maxHeight: Math.max(80, window.innerHeight - top - 8) });
    }
    place();
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) close();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { close(); return; }
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length
      : event.key === "ArrowUp" ? (index + items.length - 1) % items.length
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
  }

  async function logout() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { await onLogout(); setOpen(false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "退出失败，请重试"); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <div className={styles.account}>
    <button ref={trigger} id={id} type="button" className={styles.trigger} aria-label={`账号菜单：${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined} disabled={busy}
      onClick={() => { if (open) close(); else { setError(""); setOpen(true); } }}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setError(""); setOpen(true); } }}>
      <span className={styles.avatar} aria-hidden="true">{Array.from(name)[0] || "人"}</span>
      <span className={styles.identity}><strong>{name}</strong><span className={styles.role}>{roleLabel}</span><span className={styles.scope}>{scope}</span></span>
      <span className={styles.chevron} aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={menu} id={`${id}-menu`} role="menu" aria-labelledby={id} className={styles.menu} style={position} onKeyDown={keys}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close(false); }}>
      <a role="menuitem" tabIndex={-1} href={changePasswordHref} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); else close(false); }}>修改密码</a>
      <button role="menuitem" tabIndex={-1} type="button" disabled={busy} className={styles.logout} onClick={() => void logout()}>{busy ? "正在退出…" : "退出登录"}</button>
      {error && <p role="alert" className={styles.error}>{error}。尚未确认退出成功，请重试。</p>}
    </div>, document.body)}
  </div>;
}
