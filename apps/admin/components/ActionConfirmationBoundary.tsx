"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ConfirmDialog, type Confirm } from "./ConfirmDialog";

/** 统一确认所有明确标记的数据变更按钮；浏览、筛选和切换操作不拦截。 */
export function ActionConfirmationBoundary({ children }: { children: ReactNode }) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const bypassButton = useRef<HTMLButtonElement | null>(null);

  function captureAction(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as Element | null;
    const button = target?.closest<HTMLButtonElement>("button[data-confirm-action]");
    if (!button || button.disabled) return;
    if (button.type === "submit" && button.form && !button.form.reportValidity()) return;
    if (bypassButton.current === button) {
      bypassButton.current = null;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.confirmAction?.trim() || button.textContent?.trim() || "执行本次操作";
    setConfirm({
      title: button.dataset.confirmTitle || `确认${action}？`,
      desc: button.dataset.confirmDescription || "确认后才会真正写入或修改数据，请先核对页面上的内容。",
      confirmLabel: button.dataset.confirmLabel || `确认${action}`,
      target: button.dataset.confirmTarget,
      danger: button.dataset.confirmDanger === "true",
      onConfirm: () => {
        setConfirm(null);
        bypassButton.current = button;
        window.setTimeout(() => button.click(), 0);
      },
    });
  }

  return <div onClickCapture={captureAction}>{children}<ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} /></div>;
}
