"use client";

import { WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export type WorkflowConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  target?: string;
  tone?: "primary" | "danger";
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  defaultReason?: string;
  dateLabel?: string;
  defaultDate?: string;
  minDate?: string;
  maxDate?: string;
  dateHint?: string;
  numberLabel?: string;
  numberPlaceholder?: string;
  defaultNumber?: string;
  numberMin?: number;
  numberMax?: number;
  textLabel?: string;
  textPlaceholder?: string;
  defaultText?: string;
  textRequired?: boolean;
  onConfirm: (reason: string, occurredOn?: string, numberValue?: number, textValue?: string) => void | Promise<void>;
};

export function WorkflowConfirmationDialog({
  confirmation,
  busy = false,
  error = "",
  onClose,
}: {
  confirmation: WorkflowConfirmation | null;
  busy?: boolean;
  error?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [numberValue, setNumberValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setReason(confirmation?.defaultReason ?? "");
    setOccurredOn(confirmation?.defaultDate ?? "");
    setNumberValue(confirmation?.defaultNumber ?? "");
    setTextValue(confirmation?.defaultText ?? "");
  }, [confirmation]);
  useEffect(() => {
    if (!confirmation) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>("textarea, button:not([disabled]), input, select");
      target?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, [confirmation]);
  useEffect(() => {
    if (!confirmation) return;
    function close(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [busy, confirmation, onClose]);

  if (!confirmation) return null;
  const needsReason = Boolean(confirmation.reasonLabel);
  const reasonMissing = needsReason && confirmation.reasonRequired !== false && !reason.trim();
  const needsDate = Boolean(confirmation.dateLabel);
  const dateMissing = needsDate && !occurredOn;
  const needsNumber = Boolean(confirmation.numberLabel);
  const parsedNumber = numberValue === "" ? Number.NaN : Number(numberValue);
  const numberMissing = needsNumber && (!Number.isInteger(parsedNumber) || (confirmation.numberMin !== undefined && parsedNumber < confirmation.numberMin) || (confirmation.numberMax !== undefined && parsedNumber > confirmation.numberMax));
  const needsText = Boolean(confirmation.textLabel);
  const textMissing = needsText && confirmation.textRequired !== false && !textValue.trim();
  const danger = confirmation.tone === "danger";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="workflow-confirm-title">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex min-w-0 gap-3">
            <span className={`mt-0.5 rounded-full p-2 ${danger ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}><WarningCircle size={20} weight="fill" /></span>
            <div>
              <h2 id="workflow-confirm-title" className="m-0 text-base font-bold text-slate-950">{confirmation.title}</h2>
              <p className="mb-0 mt-1 text-sm leading-6 text-slate-600">{confirmation.description}</p>
            </div>
          </div>
          <button type="button" aria-label="关闭确认窗口" disabled={busy} onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          {confirmation.target ? <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><span className="text-slate-500">本次操作：</span><strong className="ml-1 text-slate-900">{confirmation.target}</strong></div> : null}
          {needsDate ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><label className="block text-sm font-semibold text-slate-700">{confirmation.dateLabel}<input required type="date" value={occurredOn} min={confirmation.minDate} max={confirmation.maxDate} onChange={(event) => setOccurredOn(event.target.value)} className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label><div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setOccurredOn(confirmation.minDate ?? confirmation.defaultDate ?? "")} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">最早可选日期</button>{confirmation.maxDate ? <button type="button" onClick={() => setOccurredOn(confirmation.maxDate ?? "")} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100">今天</button> : null}<span className="text-xs leading-5 text-slate-500">{confirmation.dateHint ?? "可直接填写实际日期；系统会阻止早于前一步或晚于今天的日期。"}</span></div></div> : null}
          {needsReason ? <label className="block text-sm font-semibold text-slate-700">{confirmation.reasonLabel}<textarea autoFocus value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder={confirmation.reasonPlaceholder ?? "请填写原因，方便以后核对"} className="mt-1.5 block min-h-20 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" /></label> : null}
          {needsNumber ? <label className="block text-sm font-semibold text-slate-700">{confirmation.numberLabel}<input required type="number" min={confirmation.numberMin} max={confirmation.numberMax} step="1" value={numberValue} onChange={(event) => setNumberValue(event.target.value)} placeholder={confirmation.numberPlaceholder} className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" /></label> : null}
          {needsText ? <label className="block text-sm font-semibold text-slate-700">{confirmation.textLabel}<input required={confirmation.textRequired !== false} type="text" maxLength={50} value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder={confirmation.textPlaceholder} className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" /></label> : null}
          {error ? <p role="alert" className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <p className="m-0 text-xs text-slate-500">只有点击下方确认按钮后，系统才会真正保存。</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy || reasonMissing || dateMissing || numberMissing || textMissing} onClick={() => void confirmation.onConfirm(reason.trim(), needsDate ? occurredOn : undefined, needsNumber ? parsedNumber : undefined, needsText ? textValue.trim() : undefined)} className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>{busy ? "处理中…" : confirmation.confirmLabel}</button>
        </footer>
      </section>
    </div>
  );
}
