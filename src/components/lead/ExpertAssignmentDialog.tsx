"use client";

import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ExpertAssignee = {
  id: string;
  name: string;
  role: "LEAD" | "EXPERT";
  pendingRegistration: number;
  pendingOrder: number;
  deviceAccounts: Array<{ id: string; accountNumber: string; accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS" | "SIG" }>;
};

type AssignmentCustomer = {
  phone: string;
  customerName: string | null;
  ownerName: string;
  channelName: string;
};

export function ExpertAssignmentDialog({
  customer,
  assignees,
  occurredOn,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  customer: AssignmentCustomer | null;
  assignees: ExpertAssignee[];
  occurredOn: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (assigneeId: string, occurredOn: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [date, setDate] = useState(occurredOn);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!customer) return;
    setQuery("");
    // 业务默认由本组组长作为专家接待；炒群员只有主动点选专家时才改为指定专家。
    const defaultAssignee = assignees.find((assignee) => assignee.role === "LEAD") ?? assignees[0];
    setAssigneeId(defaultAssignee?.id ?? "");
    setDate(occurredOn);
    requestAnimationFrame(() => dialogRef.current?.focus());
  }, [assignees, customer, occurredOn]);
  useEffect(() => {
    if (!customer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, customer, onClose]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assignees.filter((assignee) => !keyword || assignee.name.toLowerCase().includes(keyword));
  }, [assignees, query]);
  const selected = assignees.find((assignee) => assignee.id === assigneeId) ?? null;

  if (!mounted || !customer) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="expert-assignment-title" tabIndex={-1} className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl outline-none">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="expert-assignment-title" className="m-0 text-lg font-semibold text-slate-950">推专家并分配负责人</h2>
            <p className="mb-0 mt-1 text-sm text-slate-500">{customer.phone} · {customer.customerName ?? "未填姓名"} · {customer.ownerName} · {customer.channelName}</p>
          </div>
          <button type="button" aria-label="关闭分配窗口" disabled={busy} onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={18} /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          <label className="block text-sm font-semibold text-slate-700">介绍日期
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm text-slate-800">接手人（默认本组组长）</strong>
              <label className="relative block min-w-56">
                <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input aria-label="搜索专家或组长" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索专家或组长" className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" />
              </label>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {visible.map((assignee) => (
                <label key={assignee.id} className={`grid cursor-pointer grid-cols-[24px_minmax(110px,1fr)_110px_minmax(150px,1fr)] items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 hover:bg-slate-50 ${assigneeId === assignee.id ? "bg-blue-50/70" : ""}`}>
                  <input type="radio" name="expert-assignee" value={assignee.id} checked={assigneeId === assignee.id} onChange={() => setAssigneeId(assignee.id)} />
                  <strong className="text-slate-900">{assignee.name}</strong>
                  <span className="text-slate-500">{assignee.role === "LEAD" ? "组长" : "前台专家"}</span>
                  <span className="text-right text-xs text-slate-600">{assignee.role === "LEAD" ? `暂代客户 ${assignee.pendingRegistration + assignee.pendingOrder}` : `待注册 ${assignee.pendingRegistration}｜待开单 ${assignee.pendingOrder}`}</span>
                </label>
              ))}
              {!visible.length && <p className="m-0 px-4 py-6 text-center text-sm text-slate-500">没有匹配的专家或组长</p>}
            </div>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-700">
            {selected ? <><strong>确认后：</strong>负责人为 {selected.name}，客户进入“排队中”。</> : "本组没有可用组长，请选择一位专家。"}
            <span className="mt-1 block text-xs text-slate-500">专家开始接待时，由专家本人填写实际使用的设备号。</span>
          </div>
          {error && <p role="alert" className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy || !assigneeId || !date} onClick={() => onConfirm(assigneeId, date)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "分配中…" : "确认介绍并分配"}</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
