"use client";

import { useState } from "react";
import { formatUsd as money } from "../../lib/money";

export type ExpertPendingCustomer = {
  id: string;
  phone: string;
  customerName: string | null;
  status: "待注册" | "待开单";
  receptionName: string;
  source: string;
  expertIntroducedOn: string | null;
  registeredOn: string | null;
  nextPlan: string | null;
  nextFollowUpOn: string | null;
};

export type ExpertPerformance = {
  id: string;
  name: string;
  active: boolean;
  proxyLead: boolean;
  unassigned: boolean;
  handled: number;
  registered: number;
  ordered: number;
  depositCents: number;
  cryptoDepositCents: number;
  bankDepositCents: number;
  unclassifiedDepositCents: number;
  pendingRegistration: number;
  pendingOrder: number;
  pendingCustomers?: ExpertPendingCustomer[];
};

type DetailPage = { customers: ExpertPendingCustomer[]; total: number; page: number; loading: boolean; error: string };
type ExpertDetails = { registration: DetailPage; order: DetailPage };
const emptyDetail = (): DetailPage => ({ customers: [], total: 0, page: 0, loading: false, error: "" });

function rate(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "暂无样本";
}

function PendingList({ title, detail, onMore }: { title: string; detail: DetailPage; onMore: () => void }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <strong className="text-sm text-slate-800">{title}</strong>
        <span className="text-xs text-slate-500">共 {detail.total} 位</span>
      </div>
      <div className="divide-y divide-slate-100">
        {detail.customers.map((customer) => (
          <article key={customer.id} className="px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <strong className="text-sm text-slate-900">{customer.phone}</strong>
                <span className="ml-2 text-xs text-slate-500">{customer.customerName || "未填姓名"}</span>
              </div>
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{customer.status}</span>
            </div>
            <p className="mb-0 mt-1 text-xs text-slate-500">接粉：{customer.receptionName} · {customer.source}</p>
            <p className="mb-0 mt-1 text-xs text-slate-500">
              {customer.status === "待注册" ? `推专家 ${customer.expertIntroducedOn || "日期未填"}` : `完成注册 ${customer.registeredOn || "日期未填"}`}
              {customer.nextFollowUpOn ? ` · 下次跟进 ${customer.nextFollowUpOn}` : " · 尚未安排下次跟进"}
            </p>
            {customer.nextPlan ? <p className="mb-0 mt-1 text-xs font-medium text-slate-700">计划：{customer.nextPlan}</p> : null}
          </article>
        ))}
        {detail.loading && !detail.customers.length ? <p className="m-0 px-3 py-4 text-sm text-slate-500">正在加载客户…</p> : null}
        {detail.error ? <p className="m-0 px-3 py-4 text-sm text-red-600">{detail.error}</p> : null}
        {!detail.loading && !detail.error && !detail.customers.length ? <p className="m-0 px-3 py-4 text-sm text-emerald-700">当前没有这类待处理客户。</p> : null}
      </div>
      {detail.customers.length < detail.total ? <button type="button" disabled={detail.loading} onClick={onMore} className="w-full border-t border-slate-100 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-50">{detail.loading ? "加载中…" : `继续加载（${detail.customers.length}/${detail.total}）`}</button> : null}
    </section>
  );
}

export function ExpertPerformanceTable({
  experts,
  range,
  query = "",
}: {
  experts: ExpertPerformance[];
  range?: { from?: string; to?: string };
  query?: string;
}) {
  const [expandedId, setExpandedId] = useState("");
  const [details, setDetails] = useState<Record<string, ExpertDetails>>({});

  function updateDetail(expertId: string, kind: keyof ExpertDetails, update: (current: DetailPage) => DetailPage) {
    setDetails((current) => {
      const existing = current[expertId] ?? { registration: emptyDetail(), order: emptyDetail() };
      return { ...current, [expertId]: { ...existing, [kind]: update(existing[kind]) } };
    });
  }

  async function loadDetail(expertId: string, kind: keyof ExpertDetails, page = 1) {
    if (!range) return;
    updateDetail(expertId, kind, (current) => ({ ...current, loading: true, error: "" }));
    try {
      const params = new URLSearchParams({ stage: "expert", kind, memberId: expertId, page: String(page) });
      if (range.from && range.to) { params.set("from", range.from); params.set("to", range.to); }
      if (query) params.set("q", query);
      const response = await fetch(`/api/lead/performance-details?${params}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "客户明细加载失败");
      updateDetail(expertId, kind, (current) => ({
        customers: page === 1 ? result.customers : [...current.customers, ...result.customers],
        total: result.total,
        page: result.page,
        loading: false,
        error: "",
      }));
    } catch (reason) {
      updateDetail(expertId, kind, (current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : "客户明细加载失败" }));
    }
  }

  function toggle(expert: ExpertPerformance) {
    const opening = expandedId !== expert.id;
    setExpandedId(opening ? expert.id : "");
    if (!opening || !range) return;
    if (!details[expert.id]?.registration.page) void loadDetail(expert.id, "registration");
    if (!details[expert.id]?.order.page) void loadDetail(expert.id, "order");
  }

  return (
    <section className="lead-member-performance expert-performance overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
        <div>
          <h2 className="m-0 text-base font-semibold text-slate-900">专家成员表现</h2>
          <p className="mb-0 mt-1 text-sm text-slate-500">注册率按“已注册 ÷ 接手客户”，开单率按“已开单 ÷ 已注册”计算；入金包含首充和续充。</p>
        </div>
        <p className="m-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">点击专家可查看待注册和待开单客户</p>
      </div>
      <div className="data-table-wrap">
        <table className="data-table min-w-[1420px]">
          <thead>
            <tr>
              <th>专家成员</th>
              <th>接手客户</th>
              <th>已注册</th>
              <th>接手后注册率</th>
              <th>已开单</th>
              <th>注册后开单率</th>
              <th>入金总额</th>
              <th>加密货币</th>
              <th>银行卡</th>
              <th>历史未分类</th>
              <th>待注册</th>
              <th>待开单</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {experts.map((expert) => {
              const expanded = expandedId === expert.id;
              const initial = expert.pendingCustomers ?? [];
              const expertDetails = details[expert.id];
              const waitingRegistration = expertDetails?.registration ?? { ...emptyDetail(), customers: initial.filter((customer) => customer.status === "待注册"), total: expert.pendingRegistration };
              const waitingOrder = expertDetails?.order ?? { ...emptyDetail(), customers: initial.filter((customer) => customer.status === "待开单"), total: expert.pendingOrder };
              return [
                <tr key={expert.id} className={expert.unassigned ? "bg-red-50/40" : undefined}>
                  <td>
                    <button type="button" className="text-left font-semibold text-slate-900 hover:text-blue-700" aria-expanded={expanded} onClick={() => toggle(expert)}>{expert.name}</button>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${expert.unassigned ? "bg-red-100 text-red-700" : expert.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {expert.unassigned ? "需分配" : expert.proxyLead ? "组长代专家" : expert.active ? "在岗" : "已停用"}
                    </span>
                  </td>
                  <td><strong>{expert.handled}</strong></td>
                  <td><strong>{expert.registered}</strong></td>
                  <td><strong className={expert.handled && expert.registered / expert.handled < 0.5 ? "text-amber-700" : "text-slate-900"}>{rate(expert.registered, expert.handled)}</strong></td>
                  <td><strong>{expert.ordered}</strong></td>
                  <td><strong className={expert.registered && expert.ordered / expert.registered < 0.5 ? "text-amber-700" : "text-slate-900"}>{rate(expert.ordered, expert.registered)}</strong></td>
                  <td><strong>{money(expert.depositCents)}</strong></td>
                  <td><strong>{money(expert.cryptoDepositCents)}</strong></td>
                  <td><strong>{money(expert.bankDepositCents)}</strong></td>
                  <td><strong>{money(expert.unclassifiedDepositCents)}</strong></td>
                  <td><strong className={expert.pendingRegistration ? "text-red-700" : "text-emerald-700"}>{expert.pendingRegistration}</strong></td>
                  <td><strong className={expert.pendingOrder ? "text-red-700" : "text-emerald-700"}>{expert.pendingOrder}</strong></td>
                  <td><button type="button" className="text-sm font-semibold text-blue-700 hover:text-blue-900" aria-expanded={expanded} onClick={() => toggle(expert)}>{expanded ? "收起" : "查看客户"}</button></td>
                </tr>,
                expanded ? (
                  <tr key={`${expert.id}-detail`} className="bg-slate-50/70">
                    <td colSpan={13} className="p-0">
                      <div className="p-4">
                        <div className="mb-3">
                          <strong className="text-sm text-slate-900">{expert.name}的当前待办</strong>
                          <span className="ml-2 text-xs text-slate-500">先推动注册，再跟进开单和首充</span>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-2">
                          <PendingList title="待注册" detail={waitingRegistration} onMore={() => void loadDetail(expert.id, "registration", waitingRegistration.page + 1)} />
                          <PendingList title="已注册 · 待开单" detail={waitingOrder} onMore={() => void loadDetail(expert.id, "order", waitingOrder.page + 1)} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            {!experts.length ? <tr><td colSpan={13} className="py-8 text-center text-sm text-slate-500">本组还没有专家成员。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
