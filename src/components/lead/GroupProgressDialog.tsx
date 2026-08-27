"use client";

import { CalendarDots, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export function GroupProgressDialog({
  customer,
  currentDate,
  dayNumber,
  existingNote,
  contactAccounts,
  selectedAccountId,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  customer: { phone: string; customerName: string | null } | null;
  currentDate: string;
  dayNumber: number | null;
  existingNote: string;
  contactAccounts: Array<{ id: string; accountNumber: string; accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS" }>;
  selectedAccountId: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (note: string, deviceAccountId: string) => void;
}) {
  const [note, setNote] = useState(existingNote);
  const [deviceAccountId, setDeviceAccountId] = useState(selectedAccountId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!customer) return;
    setNote(existingNote);
    setDeviceAccountId(selectedAccountId);
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [customer, existingNote, selectedAccountId]);

  useEffect(() => {
    if (!customer) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, customer, onClose]);

  if (!customer) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="group-progress-title" className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="group-progress-title" className="m-0 text-lg font-bold text-slate-900">填写今日进度</h2>
            <p className="mt-1 text-sm text-slate-500">{customer.phone}{customer.customerName ? ` · ${customer.customerName}` : ""}</p>
          </div>
          {contactAccounts.length ? <label className="block text-sm font-semibold text-slate-700">本次炒群使用号码<select value={deviceAccountId} onChange={(event) => setDeviceAccountId(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal"><option value="">暂不填写</option>{contactAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountNumber} · {account.accountType === "NORMAL_WS" ? "普通 WS" : account.accountType === "BUSINESS_WS" ? "商业 WS" : "RCS"}</option>)}</select></label> : <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">请先在“设备账号”中新增自己的炒群号码，才能绑定到客户。</p>}
          <button type="button" aria-label="关闭每日进度弹窗" disabled={busy} onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
            <CalendarDots size={20} weight="duotone" />
            <strong>{currentDate}</strong>
            <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-blue-700">进群第 {dayNumber ?? "—"} 天</span>
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            今天跟进到哪一步了？
            <textarea
              ref={textareaRef}
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：群内有互动，已回复客户问题，明天继续观察并准备推专家。"
              rows={5}
              className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <div className="flex justify-between text-xs text-slate-400"><span>同一天再次保存会更新今天这条，不会重复增加。</span><span>{note.length}/500</span></div>
          {error ? <p role="alert" className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy || !note.trim()} onClick={() => onConfirm(note.trim(), deviceAccountId)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "保存中…" : existingNote ? "保存修改" : "保存今日进度"}</button>
        </div>
      </section>
    </div>
  );
}
