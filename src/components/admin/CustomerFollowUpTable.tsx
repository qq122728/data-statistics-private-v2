"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  customerFollowUpStageLabels,
  isClosedCustomerStage,
  type CustomerFollowUpStage,
} from "../../lib/customer-follow-up";

export type AdminCustomerFollowUpRow = {
  id: string;
  phone: string;
  customerName: string | null;
  groupId: string;
  groupName: string;
  sourceDate: string;
  channelName: string;
  sourceOwnerName: string;
  stage: CustomerFollowUpStage;
  responsibleNames: string[];
  responsibleRole: string;
  expertDeviceAccountNumber: string | null;
  collaboratorNames: string[];
  stagnationDays: number | null;
  lastActionOn: string;
  lastActionLabel: string;
  lastActorName: string;
  nextPlan: string | null;
  suggestedPlan: string;
  nextFollowUpOn: string | null;
  planOverdue: boolean;
};

function stageTone(stage: CustomerFollowUpStage) {
  if (stage === "INVALID" || stage === "LEFT_GROUP") return "bg-slate-100 text-slate-600";
  if (stage === "WAITING_EXPERT_ASSIGNMENT") return "bg-red-50 text-red-700";
  if (stage === "ORDERED") return "bg-emerald-50 text-emerald-700";
  if (stage === "REGISTERED" || stage === "EXPERT_INTRODUCED") return "bg-violet-50 text-violet-700";
  return "bg-blue-50 text-blue-700";
}

function stagnationTone(days: number | null) {
  if (days === null) return "text-slate-400";
  if (days >= 7) return "font-semibold text-red-700";
  if (days >= 3) return "font-semibold text-amber-700";
  return "text-slate-600";
}

export function CustomerFollowUpTable({
  initialRows,
  groups,
  today,
}: {
  initialRows: AdminCustomerFollowUpRow[];
  groups: Array<{ id: string; name: string }>;
  today: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [stage, setStage] = useState<CustomerFollowUpStage | "">("");
  const [attention, setAttention] = useState("");
  const [editingId, setEditingId] = useState("");
  const [planDraft, setPlanDraft] = useState("");
  const [dateDraft, setDateDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch =
        !keyword ||
        row.phone.includes(keyword) ||
        (row.customerName ?? "").toLowerCase().includes(keyword) ||
        row.sourceOwnerName.toLowerCase().includes(keyword) ||
        row.responsibleNames.some((name) => name.toLowerCase().includes(keyword));
      const matchesAttention =
        !attention ||
        (attention === "stalled" && !isClosedCustomerStage(row.stage) && (row.stagnationDays ?? 0) >= 3) ||
        (attention === "overdue" && row.planOverdue) ||
        (attention === "unassigned" && row.stage === "WAITING_EXPERT_ASSIGNMENT");
      return matchesSearch && (!groupId || row.groupId === groupId) && (!stage || row.stage === stage) && matchesAttention;
    });
  }, [attention, groupId, rows, search, stage]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const activeCount = rows.filter((row) => !isClosedCustomerStage(row.stage)).length;
  const stalledCount = rows.filter((row) => !isClosedCustomerStage(row.stage) && (row.stagnationDays ?? 0) >= 3).length;
  const overdueCount = rows.filter((row) => row.planOverdue).length;
  const unassignedCount = rows.filter((row) => row.stage === "WAITING_EXPERT_ASSIGNMENT").length;

  function beginEdit(row: AdminCustomerFollowUpRow) {
    setEditingId(row.id);
    setPlanDraft(row.nextPlan ?? row.suggestedPlan);
    setDateDraft(row.nextFollowUpOn ?? "");
    setError("");
  }

  async function savePlan(row: AdminCustomerFollowUpRow) {
    setBusy(row.id);
    setError("");
    try {
      const response = await fetch("/api/admin/customer-follow-up", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: row.id,
          nextPlan: planDraft.trim() || null,
          nextFollowUpOn: dateDraft || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                nextPlan: result.nextPlan,
                nextFollowUpOn: result.nextFollowUpOn,
                planOverdue: result.nextFollowUpOn ? result.nextFollowUpOn < today : false,
              }
            : item,
        ),
      );
      setEditingId("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  function resetFilters() {
    setSearch("");
    setGroupId("");
    setStage("");
    setAttention("");
    setPage(1);
  }

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {[
            ["跟进中客户", activeCount],
            ["停滞 ≥ 3 天", stalledCount],
            ["计划已逾期", overdueCount],
            ["待分配专家", unassignedCount],
          ].map(([label, value]) => (
            <div key={String(label)} className="px-4 py-3">
              <p className="m-0 text-xs text-slate-500">{label}</p>
              <strong className="mt-1 block text-xl text-slate-900">{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-slate-50/70 p-3">
          <label className="field-label min-w-56 flex-1">
            搜索
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="手机号、姓名、来源或当前负责人"
              className="control"
            />
          </label>
          <label className="field-label">
            小组
            <select value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1); }} className="control min-w-36">
              <option value="">全部小组</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            阶段
            <select value={stage} onChange={(event) => { setStage(event.target.value as CustomerFollowUpStage | ""); setPage(1); }} className="control min-w-44">
              <option value="">全部阶段</option>
              {Object.entries(customerFollowUpStageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field-label">
            重点关注
            <select value={attention} onChange={(event) => { setAttention(event.target.value); setPage(1); }} className="control min-w-40">
              <option value="">全部客户</option>
              <option value="stalled">停滞 ≥ 3 天</option>
              <option value="overdue">计划已逾期</option>
              <option value="unassigned">待分配专家</option>
            </select>
          </label>
          <button type="button" onClick={resetFilters} className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">清除</button>
          <span className="ml-auto pb-2 text-sm text-slate-500">共 {filtered.length} 位客户</span>
        </div>
        {error && <p role="alert" className="m-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="data-table-wrap">
          <table className="data-table min-w-[1680px]">
            <thead>
              <tr>
                <th>客户</th>
                <th>来源</th>
                <th>来源归属</th>
                <th>当前阶段</th>
                <th>当前负责人</th>
                <th>协作人</th>
                <th>停滞</th>
                <th>最近动作</th>
                <th className="min-w-[360px]">下一步计划</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const closed = isClosedCustomerStage(row.stage);
                return (
                  <tr key={row.id}>
                    <td>
                      <strong className="block text-slate-900">{row.phone}</strong>
                      <span className="text-xs text-slate-500">{row.customerName || "未填姓名"}</span>
                    </td>
                    <td>
                      <strong className="block text-slate-700">{row.groupName} · {row.channelName}</strong>
                      <span className="text-xs text-slate-500">来源日 {row.sourceDate}</span>
                    </td>
                    <td>
                      <strong className="block text-slate-800">{row.sourceOwnerName}</strong>
                      <span className="text-xs text-slate-500">前台接粉</span>
                    </td>
                    <td><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${stageTone(row.stage)}`}>{customerFollowUpStageLabels[row.stage]}</span></td>
                    <td>
                      <strong className="block text-slate-800">{row.responsibleNames.join("、") || "—"}</strong>
                      <span className="text-xs text-slate-500">{row.responsibleRole}{row.expertDeviceAccountNumber ? ` · 专家号 ${row.expertDeviceAccountNumber}` : ""}</span>
                    </td>
                    <td className="text-sm text-slate-600">{row.collaboratorNames.join("、") || "—"}</td>
                    <td className={stagnationTone(closed ? null : row.stagnationDays)}>{closed ? "已关闭" : row.stagnationDays === null ? "—" : `${row.stagnationDays} 天`}</td>
                    <td>
                      <strong className="block text-slate-700">{row.lastActionLabel}</strong>
                      <span className="text-xs text-slate-500">{row.lastActionOn} · {row.lastActorName}</span>
                    </td>
                    <td>
                      {editingId === row.id ? (
                        <div className="grid gap-2">
                          <textarea aria-label={`编辑 ${row.phone} 的下一步计划`} value={planDraft} onChange={(event) => setPlanDraft(event.target.value)} rows={2} maxLength={300} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                          <div className="flex items-center gap-2">
                            <input aria-label={`编辑 ${row.phone} 的计划日期`} type="date" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
                            <button disabled={busy === row.id} type="button" onClick={() => savePlan(row)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy === row.id ? "保存中…" : "保存"}</button>
                            <button type="button" onClick={() => setEditingId("")} className="text-sm text-slate-500">取消</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="m-0 text-sm text-slate-700">{row.nextPlan || row.suggestedPlan}</p>
                            <p className={`mt-1 text-xs ${row.planOverdue ? "font-semibold text-red-700" : "text-slate-500"}`}>
                              {row.nextPlan ? "管理员计划" : "系统建议"}
                              {row.nextFollowUpOn ? ` · ${row.nextFollowUpOn}${row.planOverdue ? " 已逾期" : ""}` : " · 未设日期"}
                            </p>
                          </div>
                          <button type="button" onClick={() => beginEdit(row)} className="shrink-0 text-sm font-semibold text-blue-600 hover:text-blue-800">编辑</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={9} className="empty-state">当前筛选没有客户</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
          <span>第 {safePage} / {totalPages} 页，每页最多 {pageSize} 条</span>
          <div className="flex gap-2">
            <button type="button" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">上一页</button>
            <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">下一页</button>
          </div>
        </div>
      </section>
    </div>
  );
}
