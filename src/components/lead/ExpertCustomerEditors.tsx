import { useEffect } from "react";
import type { ExpertCustomer } from "./expert-customer-types";

export type ExpertDetailDraft = { customerName: string; expertNotes: string; deviceAccountId: string };
export type ExpertFinanceDraft = { occurredOn: string; kind: "RECHARGE" | "WITHDRAWAL"; amount: string; continuationNumber: string; depositMethod: "CRYPTO" | "BANK" };
export type ExpertOrderDraft = { date: string; amount: string; depositMethod: "CRYPTO" | "BANK" };

export function ExpertCustomerEditors({ canEdit, editingCustomer, orderCustomer, financeCustomer, detailDraft, orderDraft, financeDraft, contactAccounts, busy, onDetailChange, onOrderChange, onFinanceChange, onCloseDetails, onCloseOrder, onCloseFinance, onSaveDetails, onSaveOrder, onSaveFinance }: {
  canEdit: boolean;
  editingCustomer: ExpertCustomer | null;
  orderCustomer: ExpertCustomer | null;
  financeCustomer: ExpertCustomer | null;
  detailDraft: ExpertDetailDraft;
  orderDraft: ExpertOrderDraft;
  financeDraft: ExpertFinanceDraft;
  contactAccounts: Array<{ id: string; accountNumber: string; accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS" }>;
  busy: string;
  onDetailChange: (draft: ExpertDetailDraft) => void;
  onOrderChange: (draft: ExpertOrderDraft) => void;
  onFinanceChange: (draft: ExpertFinanceDraft) => void;
  onCloseDetails: () => void;
  onCloseOrder: () => void;
  onCloseFinance: () => void;
  onSaveDetails: () => void;
  onSaveOrder: () => void;
  onSaveFinance: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (editingCustomer && busy !== editingCustomer.id) onCloseDetails();
      else if (orderCustomer && busy !== orderCustomer.id) onCloseOrder();
      else if (financeCustomer && busy !== `finance-${financeCustomer.id}`) onCloseFinance();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, editingCustomer, financeCustomer, onCloseDetails, onCloseFinance, onCloseOrder, orderCustomer]);

  return <>
    {canEdit && editingCustomer && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== editingCustomer.id) onCloseDetails(); }}>
      <section role="dialog" aria-modal="true" aria-label="编辑专家情况" className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">编辑专家情况</h2><p className="mt-1 text-sm text-slate-500">{editingCustomer.phone} · 这里只记录专家跟进，不会改动炒群情况或前台填写的客户情况。</p></div><button type="button" onClick={onCloseDetails} className="text-sm text-slate-500 hover:text-slate-800">关闭</button></div>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium text-slate-700">客户姓名<input aria-label="客户姓名" value={detailDraft.customerName} onChange={(event) => onDetailChange({ ...detailDraft, customerName: event.target.value })} placeholder="客户姓名（可选）" maxLength={80} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">专家情况<textarea aria-label="专家情况" value={detailDraft.expertNotes} onChange={(event) => onDetailChange({ ...detailDraft, expertNotes: event.target.value })} placeholder="例如：客户说周五完成注册；下次联系时间和重点写在这里" maxLength={300} rows={5} className="resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          {contactAccounts.length ? <label className="grid gap-1 text-sm font-medium text-slate-700">本次专家联系号码<select aria-label="专家联系号码" value={detailDraft.deviceAccountId} onChange={(event) => onDetailChange({ ...detailDraft, deviceAccountId: event.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"><option value="">暂不填写</option>{contactAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountNumber} · {account.accountType === "NORMAL_WS" ? "普通 WS" : account.accountType === "BUSINESS_WS" ? "商业 WS" : "RCS"}</option>)}</select></label> : <p className="m-0 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">请先在“设备账号”中新增自己的专家号码，才能绑定到客户。</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCloseDetails} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</button><button type="button" disabled={busy === editingCustomer.id} onClick={onSaveDetails} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === editingCustomer.id ? "保存中…" : "保存专家情况"}</button></div>
      </section>
    </div>}
    {canEdit && orderCustomer && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== orderCustomer.id) onCloseOrder(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="order-editor-title" className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div><h2 id="order-editor-title" className="m-0 text-lg font-semibold text-slate-950">登记开单{orderCustomer.isHistoricalRecord ? <span className="ml-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 align-middle text-xs font-semibold text-amber-800">历史补录</span> : null}</h2><p className="mb-0 mt-1 text-sm text-slate-500">{orderCustomer.phone} · {orderCustomer.isHistoricalRecord ? "历史补录，请填写真实开单日期和首充金额。" : "请填写实际开单日期和首充金额。"}</p></div>
          <button type="button" disabled={busy === orderCustomer.id} onClick={onCloseOrder} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50">关闭</button>
        </header>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">开单日期<input aria-label="开单日期" type="date" value={orderDraft.date} onChange={(event) => onOrderChange({ ...orderDraft, date: event.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">首充金额（美元）<input aria-label="首充金额（美元）" type="number" min="0.01" step="0.01" value={orderDraft.amount} onChange={(event) => onOrderChange({ ...orderDraft, amount: event.target.value })} placeholder="例如 500" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700 sm:col-span-2">首充入金方式<select aria-label="首充入金方式" value={orderDraft.depositMethod} onChange={(event) => onOrderChange({ ...orderDraft, depositMethod: event.target.value as ExpertOrderDraft["depositMethod"] })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"><option value="CRYPTO">加密货币入金</option><option value="BANK">银行卡入金</option></select></label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3"><button type="button" disabled={busy === orderCustomer.id} onClick={onCloseOrder} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button><button type="button" disabled={busy === orderCustomer.id} onClick={onSaveOrder} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">下一步确认</button></footer>
      </section>
    </div>}
    {canEdit && financeCustomer?.order && <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== `finance-${financeCustomer.id}`) onCloseFinance(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="finance-editor-title" className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="finance-editor-title" className="m-0 text-lg font-semibold text-slate-950">登记续充 / 出金</h2>
            <p className="mb-0 mt-1 text-sm text-slate-500">{financeCustomer.phone} · {financeCustomer.isHistoricalRecord ? "历史补录，请填写真实续充或出金日期。" : "可补录真实历史续充或出金日期，保存后会计入该客户当前业绩。"}</p>
          </div>
          <button type="button" disabled={busy === `finance-${financeCustomer.id}`} onClick={onCloseFinance} className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 disabled:opacity-50">关闭</button>
        </header>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">发生日期<input aria-label="资金发生日期" type="date" value={financeDraft.occurredOn} onChange={(event) => onFinanceChange({ ...financeDraft, occurredOn: event.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">资金类型<select aria-label="资金类型" value={financeDraft.kind} onChange={(event) => onFinanceChange({ ...financeDraft, kind: event.target.value as ExpertFinanceDraft["kind"] })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"><option value="RECHARGE">续充入金</option><option value="WITHDRAWAL">出金</option></select></label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">金额（美元）<input aria-label="资金金额（美元）" type="number" min="0.01" step="0.01" value={financeDraft.amount} onChange={(event) => onFinanceChange({ ...financeDraft, amount: event.target.value })} placeholder="例如 500" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label>
          {financeDraft.kind === "RECHARGE" ? <label className="grid gap-1.5 text-sm font-semibold text-slate-700">入金方式<select aria-label="续充入金方式" value={financeDraft.depositMethod} onChange={(event) => onFinanceChange({ ...financeDraft, depositMethod: event.target.value as ExpertFinanceDraft["depositMethod"] })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal"><option value="CRYPTO">加密货币入金</option><option value="BANK">银行卡入金</option></select></label> : null}
          {financeDraft.kind === "RECHARGE" ? <label className="grid gap-1.5 text-sm font-semibold text-slate-700">第几次续充<input aria-label="续充次数" type="number" min="1" step="1" value={financeDraft.continuationNumber} onChange={(event) => onFinanceChange({ ...financeDraft, continuationNumber: event.target.value })} placeholder="例如 2" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal" /></label> : <p className="m-0 self-end pb-2 text-sm text-slate-500">出金无需填写续充次数。</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <button type="button" disabled={busy === `finance-${financeCustomer.id}`} onClick={onCloseFinance} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy === `finance-${financeCustomer.id}`} onClick={onSaveFinance} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === `finance-${financeCustomer.id}` ? "保存中…" : "确认保存"}</button>
        </footer>
      </section>
    </div>}
  </>;
}
