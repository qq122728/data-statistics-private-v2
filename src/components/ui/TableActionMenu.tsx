"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export type TableActionMenuItem = {
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void;
};

export function TableActionMenu({ items }: { items: TableActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function openMenu() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({ top: rect.bottom + 5, left: Math.max(8, rect.right - 168) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function closeOnScroll() { setOpen(false); }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keydown);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  if (!items.length) return null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => open ? setOpen(false) : openMenu()}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-600 outline-none hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-300/70"
      >
        更多 <CaretDown size={13} weight="bold" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="更多客户操作"
          style={{ top: position.top, left: position.left }}
          className="fixed z-[70] w-[168px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onSelect(); }}
              className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm font-medium disabled:opacity-50 ${item.tone === "danger" ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"}`}
            >
              {item.icon}{item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
