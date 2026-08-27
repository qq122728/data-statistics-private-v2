"use client";

import { useState } from "react";
import { leaveOrderLabel, type GroupLeaveAssessment } from "../../lib/group-leave";

export type GroupOperatorPendingCustomer = {
  id: string;
  phone: string;
  customerName: string | null;
  receptionName: string;
  sourceDate: string;
  channelName: string;
  joinedOn: string | null;
  leftOn?: string | null;
  leaveAssessment?: GroupLeaveAssessment | null;
  leftWithOrder?: boolean;
  followUpCount: number;
  lastFollowedUpOn: string | null;
  expertName?: string | null;
};

export type GroupOperatorPerformance = {
  id: string;
  name: string;
  active: boolean;
  unassigned: boolean;
  receptionNames: string[];
  handled: number;
  inGroup: number;
  introduced: number;
  left: number;
  earlyLeft: number;
  watchLeft: number;
  normalLeft: number;
  unknownLeft: number;
  leftWithOrder: number;
  leftWithoutOrder: number;
  pendingIntroduction: number;
  firstDepositCents: number;
  pendingCustomers?: GroupOperatorPendingCustomer[];
  introducedCustomers?: GroupOperatorPendingCustomer[];
};

type DetailPage = {
  customers: GroupOperatorPendingCustomer[];
  total: number;
  page: number;
  loading: boolean;
  error: string;
};

type OperatorDetails = { pending: DetailPage; introduced: DetailPage; left: DetailPage };

const emptyDetail = (): DetailPage => ({ customers: [], total: 0, page: 0, loading: false, error: "" });

function rate(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "暂无样本";
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function GroupOperatorPerformanceTable({
  operators,
  range,
  query = "",
}: {
  operators: GroupOperatorPerformance[];
  range?: { from?: string; to?: string };
  query?: string;
}) {
  const [expandedId, setExpandedId] = useState("");
  const [details, setDetails] = useState<Record<string, OperatorDetails>>({});

  function updateDetail(operatorId: string, kind: keyof OperatorDetails, update: (current: DetailPage) => DetailPage) {
    setDetails((current) => {
      const existing = current[operatorId] ?? { pending: emptyDetail(), introduced: emptyDetail(), left: emptyDetail() };
      return { ...current, [operatorId]: { ...existing, [kind]: update(existing[kind]) } };
    });
  }

  async function loadDetail(operatorId: string, kind: keyof OperatorDetails, page = 1) {
    if (!range) return;
    updateDetail(operatorId, kind, (current) => ({ ...current, loading: true, error: "" }));
    try {
      const params = new URLSearchParams({ stage: "group", kind, memberId: operatorId, page: String(page) });
      if (range.from && range.to) { params.set("from", range.from); params.set("to", range.to); }
      if (query) params.set("q", query);
      const response = await fetch(`/api/lead/performance-details?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "客户明细加载失败");
      updateDetail(operatorId, kind, (current) => ({
        customers: page === 1 ? result.customers : [...current.customers, ...result.customers],
        total: result.total,
        page: result.page,
        loading: false,
        error: "",
      }));
    } catch (reason) {
      updateDetail(operatorId, kind, (current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : "客户明细加载失败" }));
    }
  }

  function toggle(operator: GroupOperatorPerformance) {
    const opening = expandedId !== operator.id;
    setExpandedId(opening ? operator.id : "");
    if (!opening || !range) return;
    if (!details[operator.id]?.pending.page) void loadDetail(operator.id, "pending");
    if (!details[operator.id]?.introduced.page) void loadDetail(operator.id, "introduced");
    if (!details[operator.id]?.left.page) void loadDetail(operator.id, "left");
  }

  return (
    <section className="lead-member-performance group-operator-performance overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-900">炒群成员表现</h2>
          <p className="mb-0 mt-1 text-sm text-slate-500">接手后推专家率和异常退群率均按接手客户计算；首充为协作业绩展示，不会在小组总账重复相加；1–8天退群为异常，9–13天观察，第14天起正常。</p>
        </div>
        <p className="m-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">点击成员查看待介绍与退群号码</p>
      </div>
      <div className="data-table-wrap">
        <table className="data-table min-w-[1400px]">
          <thead>
            <tr>
              <th>炒群成员</th>
              <th>配合接粉成员</th>
              <th>接手客户</th>
              <th>当前在群</th>
              <th>推专家</th>
              <th>接手后推专家率</th>
              <th>退群 / 异常退群率</th>
              <th>退群分层</th>
              <th>退群结果</th>
              <th>待介绍</th>
              <th>首充（协作）</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {operators.map((operator) => {
              const expanded = expandedId === operator.id;
              const operatorDetails = details[operator.id];
              const pending = operatorDetails?.pending ?? { ...emptyDetail(), customers: operator.pendingCustomers ?? [], total: operator.pendingIntroduction };
              const introduced = operatorDetails?.introduced ?? { ...emptyDetail(), customers: operator.introducedCustomers ?? [], total: operator.introduced };
              const leftCustomers = operatorDetails?.left ?? { ...emptyDetail(), customers: [], total: operator.left };
              return [
                <tr key={operator.id} className={operator.unassigned ? "bg-red-50/40" : undefined}>
                  <td>
                    <button type="button" className="text-left font-semibold text-slate-900 hover:text-blue-700" aria-expanded={expanded} onClick={() => toggle(operator)}>{operator.name}</button>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${operator.unassigned ? "bg-red-100 text-red-700" : operator.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {operator.unassigned ? "需分配" : operator.active ? "在岗" : "已停用"}
                    </span>
                  </td>
                  <td>{operator.receptionNames.length ? operator.receptionNames.join("、") : <span className="text-slate-400">尚未配置</span>}</td>
                  <td><strong>{operator.handled}</strong></td>
                  <td><strong>{operator.inGroup}</strong></td>
                  <td><strong>{operator.introduced}</strong></td>
                  <td><strong className={operator.handled && operator.introduced / operator.handled < 0.5 ? "text-amber-700" : "text-slate-900"}>{rate(operator.introduced, operator.handled)}</strong></td>
                  <td><strong>{operator.left}</strong><span className="mt-1 block text-xs text-slate-500">{rate(operator.earlyLeft, operator.handled)}</span></td>
                  <td className="whitespace-nowrap"><span className={operator.earlyLeft ? "font-semibold text-red-700" : "text-slate-500"}>异常 {operator.earlyLeft}</span><span className="block text-xs text-amber-700">观察 {operator.watchLeft}</span><span className="block text-xs text-emerald-700">正常 {operator.normalLeft}{operator.unknownLeft ? ` · 待核对 ${operator.unknownLeft}` : ""}</span></td>
                  <td className="whitespace-nowrap"><span className="font-semibold text-emerald-700">已开单 {operator.leftWithOrder}</span><span className={operator.leftWithoutOrder ? "block text-xs font-semibold text-red-700" : "block text-xs text-slate-500"}>未开单 {operator.leftWithoutOrder}</span></td>
                  <td><strong className={operator.pendingIntroduction ? "text-red-700" : "text-emerald-700"}>{operator.pendingIntroduction}</strong></td>
                  <td><strong className="text-slate-900">{money(operator.firstDepositCents)}</strong></td>
                  <td><button type="button" className="text-sm font-semibold text-blue-700 hover:text-blue-900" aria-expanded={expanded} onClick={() => toggle(operator)}>{expanded ? "收起" : "查看客户"}</button></td>
                </tr>,
                expanded ? (
                  <tr key={`${operator.id}-detail`} className="bg-slate-50/70">
                    <td colSpan={12} className="p-0">
                      <div className="p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <strong className="text-sm text-slate-900">{operator.name}的客户号码</strong>
                            <span className="ml-2 text-xs text-slate-500">待介绍 {operator.pendingIntroduction} 位 · 已介绍 {operator.introduced} 位 · 异常退群 {operator.earlyLeft} 位</span>
                          </div>
                          <span className="text-xs text-slate-500">号码仅在展开后按页加载</span>
                        </div>
                        <div className="grid gap-3 xl:grid-cols-2">
                          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">已进群 · 待推专家</div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>手机号 / 姓名</th><th>接粉 / 来源</th><th>入群</th></tr></thead><tbody>{pending.customers.map((customer) => <tr key={customer.id}><td><strong>{customer.phone}</strong><span className="ml-2 text-xs text-slate-500">{customer.customerName || "未填姓名"}</span></td><td>{customer.receptionName}<span className="block text-xs text-slate-500">{customer.sourceDate} · {customer.channelName}</span></td><td>{customer.joinedOn || "日期未填"}</td></tr>)}{pending.loading && !pending.customers.length ? <tr><td colSpan={3} className="empty-state">正在加载客户…</td></tr> : null}{pending.error ? <tr><td colSpan={3} className="empty-state text-red-600">{pending.error}</td></tr> : null}{!pending.loading && !pending.error && !pending.customers.length ? <tr><td colSpan={3} className="empty-state">当前没有待推专家的在群客户。</td></tr> : null}</tbody></table></div>{pending.customers.length < pending.total ? <button type="button" disabled={pending.loading} onClick={() => void loadDetail(operator.id, "pending", pending.page + 1)} className="w-full border-t border-slate-100 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50">{pending.loading ? "加载中…" : `继续加载（${pending.customers.length}/${pending.total}）`}</button> : null}</section>
                          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">已推专家号码</div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>手机号 / 姓名</th><th>专家</th><th>接粉 / 来源</th></tr></thead><tbody>{introduced.customers.map((customer) => <tr key={customer.id}><td><strong>{customer.phone}</strong><span className="ml-2 text-xs text-slate-500">{customer.customerName || "未填姓名"}</span></td><td>{customer.expertName || "待分配"}</td><td>{customer.receptionName}<span className="block text-xs text-slate-500">{customer.sourceDate} · {customer.channelName}</span></td></tr>)}{introduced.loading && !introduced.customers.length ? <tr><td colSpan={3} className="empty-state">正在加载客户…</td></tr> : null}{introduced.error ? <tr><td colSpan={3} className="empty-state text-red-600">{introduced.error}</td></tr> : null}{!introduced.loading && !introduced.error && !introduced.customers.length ? <tr><td colSpan={3} className="empty-state">当前没有已推专家客户。</td></tr> : null}</tbody></table></div>{introduced.customers.length < introduced.total ? <button type="button" disabled={introduced.loading} onClick={() => void loadDetail(operator.id, "introduced", introduced.page + 1)} className="w-full border-t border-slate-100 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50">{introduced.loading ? "加载中…" : `继续加载（${introduced.customers.length}/${introduced.total}）`}</button> : null}</section>
                          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white xl:col-span-2"><div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">退群号码 · 按退群天数和退群当时开单结果标记</div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>手机号 / 姓名</th><th>退群情况</th><th>退群当时</th><th>接粉 / 来源</th></tr></thead><tbody>{leftCustomers.customers.map((customer) => { const assessment = customer.leaveAssessment; const badge = assessment?.level === "EARLY" ? "bg-red-50 text-red-700" : assessment?.level === "WATCH" ? "bg-amber-50 text-amber-700" : assessment?.level === "NORMAL" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"; return <tr key={customer.id}><td><strong>{customer.phone}</strong><span className="ml-2 text-xs text-slate-500">{customer.customerName || "未填姓名"}</span></td><td><span className={`rounded-full px-2 py-1 text-xs font-semibold ${badge}`}>{assessment?.dayNumber ? `第 ${assessment.dayNumber} 天 · ` : ""}{assessment?.label ?? "退群日期待核对"}</span><span className="mt-1 block text-xs text-slate-500">退群日期 {customer.leftOn || "未填写"}</span></td><td><span className={`font-semibold ${customer.leftWithOrder ? "text-emerald-700" : "text-red-700"}`}>{leaveOrderLabel(Boolean(customer.leftWithOrder))}</span></td><td>{customer.receptionName}<span className="block text-xs text-slate-500">{customer.sourceDate} · {customer.channelName}</span></td></tr>; })}{leftCustomers.loading && !leftCustomers.customers.length ? <tr><td colSpan={4} className="empty-state">正在加载退群客户…</td></tr> : null}{leftCustomers.error ? <tr><td colSpan={4} className="empty-state text-red-600">{leftCustomers.error}</td></tr> : null}{!leftCustomers.loading && !leftCustomers.error && !leftCustomers.customers.length ? <tr><td colSpan={4} className="empty-state">当前没有退群客户。</td></tr> : null}</tbody></table></div>{leftCustomers.customers.length < leftCustomers.total ? <button type="button" disabled={leftCustomers.loading} onClick={() => void loadDetail(operator.id, "left", leftCustomers.page + 1)} className="w-full border-t border-slate-100 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50">{leftCustomers.loading ? "加载中…" : `继续加载（${leftCustomers.customers.length}/${leftCustomers.total}）`}</button> : null}</section>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            {!operators.length ? <tr><td colSpan={12} className="py-8 text-center text-sm text-slate-500">本组还没有炒群成员。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
