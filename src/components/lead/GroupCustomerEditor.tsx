"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";

export function GroupCustomerEditor({
  customer,
  busy,
  error,
  onClose,
  onSave,
}: {
  customer: { phone: string; customerName: string | null; notes: string | null } | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (values: { customerName: string; notes: string }) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (!customer) return;
    setCustomerName(customer.customerName ?? "");
    setNotes(customer.notes ?? "");
  }, [customer]);
  if (!customer) return null;
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="group-customer-editor-title" className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div><h2 id="group-customer-editor-title" className="m-0 text-lg font-bold text-slate-900">编辑客户资料</h2><p className="mt-1 text-sm text-slate-500">{customer.phone} · 炒群情况请用“填写情况”记录。</p></div><button type="button" aria-label="关闭编辑客户资料" disabled={busy} onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button></header><div className="space-y-4 p-5"><label className="block text-sm font-semibold text-slate-700">客户姓名<input value={customerName} maxLength={80} onChange={(event) => setCustomerName(event.target.value)} placeholder="客户姓名" className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><label className="block text-sm font-semibold text-slate-700">客户公共备注<textarea value={notes} maxLength={300} rows={4} onChange={(event) => setNotes(event.target.value)} placeholder="例如：客户退群后仍在联系，计划下周推专家。" className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>{error ? <p role="alert" className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}</div><footer className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">取消</button><button type="button" disabled={busy} onClick={() => onSave({ customerName: customerName.trim(), notes: notes.trim() })} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "保存中…" : "保存编辑"}</button></footer></section></div>;
}
