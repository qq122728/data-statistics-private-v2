"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/Button";

export type RiskDecisionLevel = "LIMIT_WATCH" | "ELIMINATION_WATCH";
export type SavedRiskDecision = {
  id: string;
  level: RiskDecisionLevel;
  evidenceThrough: string;
  reason: string;
  createdAt: string;
};

const levelName = { LIMIT_WATCH: "限流观察", ELIMINATION_WATCH: "淘汰观察" } as const;

export function RiskDecisionDialog({ open, memberId, memberName, level, evidenceThrough, onClose, onConfirmed }: {
  open: boolean;
  memberId: string;
  memberName: string;
  level: RiskDecisionLevel;
  evidenceThrough: string;
  onClose: () => void;
  onConfirmed: (decision: SavedRiskDecision) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  useEffect(() => setMounted(true), []);
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReason("");
    setError("");
    textareaRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (savingRef.current) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      event.stopPropagation();
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
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      previousFocus.current?.focus();
    };
  }, [mounted, onClose, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 4) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/risk-decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, level, evidenceThrough, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; latestDecision?: SavedRiskDecision };
      if (!response.ok || !body.latestDecision) throw new Error(body.error ?? "人工确认失败");
      onConfirmed(body.latestDecision);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "人工确认失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!open || !mounted) return null;
  return createPortal(<div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="presentation">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={`人工确认${levelName[level]}`} tabIndex={-1} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
      <h2 className="text-lg font-bold text-slate-950">人工确认{levelName[level]}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">对“{memberName}”记录管理判断，证据截止 {evidenceThrough}。这不会自动停用账号或调整流量。</p>
      <form onSubmit={submit} className="mt-4 space-y-4"><label className="field-label">确认原因<textarea ref={textareaRef} aria-label="确认原因" value={reason} onChange={(event) => setReason(event.target.value)} minLength={4} required rows={4} className="control resize-y" placeholder="至少 4 个字，说明人工复核依据" /></label>{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>取消</Button><Button type="submit" variant={level === "ELIMINATION_WATCH" ? "danger" : "primary"} disabled={saving || reason.trim().length < 4}>{saving ? "提交中…" : "提交人工确认"}</Button></div></form>
    </section>
  </div>, document.body);
}
