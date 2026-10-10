"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

export default function CredentialForm({ action, busy, onSubmit, children, gap = 14 }: {
  action: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  children: ReactNode;
  gap?: number;
}) {
  const [ready, setReady] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (ready && document.activeElement === document.body) {
      form.current?.querySelector<HTMLInputElement>("input[autofocus]")?.focus();
    }
  }, [ready]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy || submitting.current) return;
    submitting.current = true;
    try { await onSubmit(event); }
    finally { submitting.current = false; }
  }

  // The server-rendered form cannot submit credentials before React attaches handlers.
  // POST also keeps credentials out of the URL if a native submission ever occurs.
  return <form ref={form} method="post" action={action} onSubmit={submit}>
    <fieldset disabled={!ready || busy} aria-busy={!ready || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap }}>
      {children}
    </fieldset>
    {!ready && <p role="status">正在准备表单，请稍候…</p>}
    <noscript><p role="alert">请启用浏览器 JavaScript 后刷新页面，再继续操作。</p></noscript>
  </form>;
}
