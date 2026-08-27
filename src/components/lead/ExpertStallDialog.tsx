"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ExpertCustomer } from "./expert-customer-types";

const reasons = [
  ["NO_RESPONSE", "客户不回复"],
  ["NO_BUDGET", "暂时没有资金"],
  ["NO_TRUST", "不信任 / 仍在观望"],
  ["REFUSED", "明确拒绝"],
  ["OTHER", "其他原因"],
] as const;

export function expertStallReasonLabel(reason: string | null | undefined) {
  return reasons.find(([value]) => value === reason)?.[1] ?? "待补充原因";
}

export function ExpertStallDialog({ customer, mode = "stalled", busy, error, onClose, onConfirm }: {
  customer: ExpertCustomer | null;
  mode?: "stalled" | "noInitialDeposit";
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (reason: (typeof reasons)[number][0], note: string) => void;
}) {
  const [reason, setReason] = useState<(typeof reasons)[number][0]>("NO_RESPONSE");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!customer) return;
    setReason("NO_RESPONSE");
    setNote("");
  }, [customer]);
  if (!customer) return null;
  const needNote = reason === "OTHER";
  const isNoDeposit = mode === "noInitialDeposit";

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="expert-stall-title">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div><h2 id="expert-stall-title" className="m-0 text-base font-bold text-slate-950">{isNoDeposit ? "标记不首充" : "标记杀不动"}</h2><p className="mb-0 mt-1 text-sm leading-6 text-slate-600">{isNoDeposit ? "客户会保留在专家跟进中，并清楚标明未首充原因；以后可恢复正常首充跟进。" : "客户会移到“杀不动”名单，不会删除；以后仍可恢复继续跟进。"}</p></div>
        <button type="button" aria-label={`关闭${isNoDeposit ? "不首充" : "杀不动"}窗口`} disabled={busy} onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button>
      </header>
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm"><span className="text-slate-500">客户：</span><strong className="text-slate-900">{customer.phone}{customer.customerName ? ` · ${customer.customerName}` : ""}</strong></div>
        <label className="block text-sm font-semibold text-slate-700">原因<select aria-label="杀不动原因" value={reason} onChange={(event) => setReason(event.target.value as typeof reason)} className="mt-1.5 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal"><option value="NO_RESPONSE">客户不回复</option><option value="NO_BUDGET">暂时没有资金</option><option value="NO_TRUST">不信任 / 仍在观望</option><option value="REFUSED">明确拒绝</option><option value="OTHER">其他原因</option></select></label>
        <label className="block text-sm font-semibold text-slate-700">补充说明{needNote ? "（必填）" : "（可选）"}<textarea aria-label={`${isNoDeposit ? "不首充" : "杀不动"}补充说明`} value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder={needNote ? "请说明具体情况" : "例如：下月再联系"} className="mt-1.5 block min-h-20 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
        {error ? <p role="alert" className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      </div>
      <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">取消</button><button type="button" disabled={busy || (needNote && !note.trim())} onClick={() => onConfirm(reason, note.trim())} className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${isNoDeposit ? "bg-orange-600 hover:bg-orange-700" : "bg-rose-600 hover:bg-rose-700"}`}>{busy ? "保存中…" : "确认标记"}</button></footer>
    </section>
  </div>;
}
