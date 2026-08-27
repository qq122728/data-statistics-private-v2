"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ExpertContactDialog({
  customer,
  occurredOn,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  customer: { phone: string; expertOwnerName: string | null } | null;
  occurredOn: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (occurredOn: string, contactNote: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [date, setDate] = useState(occurredOn);
  const [note, setNote] = useState("");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!customer) return;
    setDate(occurredOn);
    setNote("");
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, [customer, occurredOn]);
  useEffect(() => {
    if (!customer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, customer, onClose]);

  if (!mounted || !customer) return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="expert-contact-title" tabIndex={-1} className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div><h2 id="expert-contact-title" className="m-0 text-lg font-semibold text-slate-950">确认客户已联系专家？</h2><p className="mb-0 mt-1 text-sm text-slate-500">{customer.phone} · {customer.expertOwnerName}</p></div>
          <button type="button" aria-label="关闭联系确认窗口" disabled={busy} onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          <label className="block text-sm font-semibold text-slate-700">联系日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="block text-sm font-semibold text-slate-700">联系备注（选填）<input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="如：已添加专家微信" className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></label>
          <p className="m-0 rounded-md bg-blue-50 px-3 py-2 text-xs text-slate-600">确认后，状态将从“待联系”变为“已联系”，专家可以继续登记注册。</p>
          {error && <p role="alert" className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy || !date} onClick={() => onConfirm(date, note.trim())} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "确认已联系"}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
