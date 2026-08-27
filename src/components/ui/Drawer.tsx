"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode } from "react";

export function Drawer({ title, open, onClose, children, className = "" }: { title: string; open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/25" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} aria-modal="true" role="dialog" aria-label={title} tabIndex={-1} className={`h-full w-full max-w-sm overflow-y-auto border-l border-slate-200 bg-white shadow-2xl ${className}`}>
      <header className="flex h-16 items-center justify-between border-b border-slate-200 px-5"><h2 className="font-semibold">{title}</h2><button ref={closeButtonRef} aria-label="关闭" onClick={onClose} className="rounded p-2 text-slate-500 hover:bg-slate-100"><X size={20} aria-hidden="true" /></button></header>
      {children}
    </section>
  </div>;
}
