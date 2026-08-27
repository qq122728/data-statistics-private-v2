"use client";

import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { parseHighRiskReason } from "../../lib/high-risk-reason";
import type { HighRiskCredentials } from "./admin-high-risk";

export function HighRiskConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  passwordLabel = "当前管理员密码",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  passwordLabel?: string;
  onClose: () => void;
  onConfirm: (credentials: HighRiskCredentials) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();
  const parsedReason = parseHighRiskReason(reason);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setPassword("");
    setError("");
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const background = document.querySelector<HTMLElement>(".app-shell");
    const backgroundWasInert = background?.hasAttribute("inert") ?? false;
    background?.setAttribute("inert", "");
    requestAnimationFrame(() => reasonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (savingRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      event.stopPropagation();
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
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
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (!backgroundWasInert) background?.removeAttribute("inert");
      previousFocusRef.current?.focus();
    };
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentReason = parseHighRiskReason(reason);
    if (!currentReason.success || !password) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onConfirm({
        highRiskReason: currentReason.value,
        currentPassword: password,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认失败，请重试");
      setPassword("");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!open) return null;
  const content = (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !savingRef.current
        )
          onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-slate-950">
          {title}
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm leading-6 text-slate-600"
        >
          {description}
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            操作原因
            <textarea
              ref={reasonRef}
              name="highRiskReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              minLength={4}
              maxLength={500}
              rows={3}
              placeholder="至少 4 个字，说明为什么要执行此操作"
              className="mt-2 w-full resize-y rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-red-500"
            />
            <span className="mt-1 block text-sm font-normal text-slate-500">
              至少 4 个字，会记录到操作日志。
            </span>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            {passwordLabel}
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-red-500"
            />
            <span className="mt-1 block text-sm font-normal text-slate-500">
              只用于本次身份确认，不会写入操作日志。
            </span>
          </label>
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={
                saving || !parsedReason.success || password.length === 0
              }
              className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "确认中…" : confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
  return typeof document === "undefined"
    ? content
    : createPortal(content, document.body);
}
