"use client";

import { Eye, NotePencil } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { groupDayNumber } from "../../lib/group-progress";
import { Drawer } from "../ui/Drawer";
import type { EntryLead } from "./entry-types";
import { CustomerProfileDetails } from "./CustomerProfileDrawer";
import { formatUsd } from "../../lib/money";
import { expertWorkflowStageLabel, expertWorkflowTrackingHours, expertWorkflowTrackingOverdue, resolveExpertWorkflowStage } from "../../lib/expert-workflow-stage";

type ProgressItem = {
  id: string;
  occurredOn: string;
  note: string | null;
  actor: { name: string };
};

type ExpertProgressItem = ProgressItem & {
  kind: "EXPERT_CONTACTED" | "REGISTERED" | "PLAN_UPDATED";
};

type ProgressDetail = {
  customer: {
    id: string;
    phone: string;
    customerName: string | null;
    joinedOn: string | null;
    leftOn: string | null;
    groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
    expertIntroducedOn: string | null;
    expertContactedOn: string | null;
    expertContactNote: string | null;
    expertWorkflowStage: "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED" | null;
    expertStageChangedAt: string | null;
    expertTrackingStartedAt: string | null;
    registeredOn: string | null;
    nextPlan: string | null;
    nextFollowUpOn: string | null;
    notes: string | null;
    expertOwner: { name: string } | null;
    groupOperatorName: string | null;
    hasActiveOrder: boolean;
  };
  groupProgress: ProgressItem[];
  expertProgress: ExpertProgressItem[];
};

const expertKindLabel: Record<ExpertProgressItem["kind"], string> = {
  EXPERT_CONTACTED: "确认联系",
  REGISTERED: "完成注册",
  PLAN_UPDATED: "备注与计划",
};

function operatorName(lead: EntryLead) {
  return lead.groupOperatorOwner?.name
    ?? lead.owner.receptionistAssignments[0]?.groupOperator.name
    ?? "待分配";
}

function resultLabel(lead: EntryLead) {
  const expertStage = resolveExpertWorkflowStage({ ...lead, hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt) });
  if (expertStage) return expertWorkflowStageLabel(expertStage);
  if (lead.customerOrder && !lead.customerOrder.voidedAt) return "已开单";
  if (lead.registeredOn) return "已注册";
  if (lead.expertContactedOn) return "已联系专家";
  if (lead.expertIntroducedOn) return "待联系专家";
  if (lead.groupStatus === "JOINED") return "炒群跟进中";
  if (lead.groupStatus === "LEFT") return "已退群";
  return "尚未入群";
}

/** 前台只读查看专家的最后情况；专家备注、下一步与阶段有明确优先级。 */
function expertSituationSummary(lead: EntryLead) {
  if (lead.expertNotes) return lead.expertNotes;
  if (lead.nextPlan) return `下一步：${lead.nextPlan}`;
  if (lead.expertContactNote) return lead.expertContactNote;
  if (lead.registeredOn) return `已注册 · ${lead.registeredOn}`;
  if (lead.expertContactedOn) return `专家已联系 · ${lead.expertContactedOn}`;
  return lead.expertIntroducedOn ? "已推专家，等待专家接待" : "尚未推专家";
}

function financialSummary(lead: EntryLead) {
  const activeOrder = lead.customerOrder && !lead.customerOrder.voidedAt ? lead.customerOrder : null;
  const recharges = (activeOrder?.events ?? []).filter((event) => event.kind === "RECHARGE" && !event.voidedAt);
  const withdrawals = (activeOrder?.events ?? []).filter((event) => event.kind === "WITHDRAWAL" && !event.voidedAt);
  const initialCents = activeOrder?.initialDepositCents ?? 0;
  const rechargeCents = recharges.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
  const withdrawalCents = withdrawals.reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
  const netCents = initialCents + rechargeCents - withdrawalCents;
  return { initialCents, rechargeCents, withdrawalCents, netCents, recharges, withdrawals };
}

export function ReceptionDownstreamProgress({
  leads,
  today,
  compact = false,
  focusLeadId,
  onFocusHandled,
  onVoidErroneousEntry,
  actionDisabled,
}: {
  leads: EntryLead[];
  today: string;
  compact?: boolean;
  focusLeadId?: string | null;
  onFocusHandled?: () => void;
  /** 接粉员发现历史录入错误时，保留记录并从后续统计中剔除。 */
  onVoidErroneousEntry?: (lead: EntryLead) => void;
  actionDisabled?: (lead: EntryLead) => boolean;
}) {
  const [selected, setSelected] = useState<EntryLead | null>(null);
  const [detail, setDetail] = useState<ProgressDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const close = useCallback(() => {
    setSelected(null);
    setDetail(null);
    setError("");
  }, []);

  async function open(lead: EntryLead) {
    setSelected(lead);
    setDetail(null);
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/leads/${lead.id}/downstream-progress`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "进度加载失败");
      setDetail(payload as ProgressDetail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "进度加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!focusLeadId) return;
    const lead = leads.find((item) => item.id === focusLeadId);
    if (lead) void open(lead);
    onFocusHandled?.();
  // `open` intentionally changes with local loading state; a selected id should open once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLeadId, leads, onFocusHandled]);

  return <section className={compact ? "" : "member-overview-customers"}>
    {!compact ? <>
    <div className="member-table-wrap"><table aria-label="客户后续进度" className="member-table reception-progress-table">
      <colgroup>
        <col className="reception-progress-customer-column" />
        <col className="reception-progress-handoff-column" />
        <col className="reception-progress-latest-column" />
        <col className="reception-progress-finance-column" />
        <col className="reception-progress-actions-column" />
      </colgroup>
      <thead><tr><th>客户</th><th>交接与负责人</th><th>最新进度</th><th>资金与业绩</th><th>操作</th></tr></thead>
      <tbody>
        {leads.map((lead) => {
          const day = groupDayNumber(lead.joinedOn, lead.groupStatus === "LEFT" && lead.leftOn ? lead.leftOn : today);
          const groupProgress = lead.activities.find((activity) => activity.kind === "GROUP_PROGRESS_UPDATED");
          const finance = financialSummary(lead);
          return <tr key={lead.id}>
            <td><div className="reception-progress-customer"><strong className="member-phone">{lead.phone}</strong><span>{lead.customerName ?? "未填写姓名"}</span>{lead.isHistoricalRecord ? <small className="font-semibold text-violet-700">历史补录 · {lead.historicalSourceName || lead.batch.channel.name}</small> : null}<small>{day ? `进群第 ${day} 天` : "尚未入群"}</small></div></td>
            <td><div className="reception-progress-handoff"><div><small>粉的归属</small><strong>{lead.attributionOwner?.name ?? lead.owner.name}</strong></div><div><small>炒群负责人</small><strong>{operatorName(lead)}</strong></div><div><small>专家负责人</small><strong>{lead.expertOwner?.name ?? "待分配"}</strong></div><div><small>专家当前阶段</small><strong data-stage={resolveExpertWorkflowStage({ ...lead, hasActiveOrder: Boolean(lead.customerOrder && !lead.customerOrder.voidedAt) }) ?? undefined}>{resultLabel(lead)}</strong></div></div></td>
            <td><div className="reception-progress-latest"><section><small>炒群最新进度</small><p>{groupProgress?.note ?? (lead.groupStatus === "JOINED" ? "暂无每日进度" : "—")}</p>{groupProgress ? <span>{groupProgress.occurredOn} · {groupProgress.actor.name}</span> : null}</section><section><small>专家情况</small><p title={expertSituationSummary(lead)}>{expertSituationSummary(lead)}</p><span>专家：{lead.expertOwner?.name ?? "待分配"} · 只读</span></section></div></td>
            <td><div className="reception-progress-finance"><div><span>首充</span><strong>{formatUsd(finance.initialCents)}</strong></div><div><span>续充</span><strong>{finance.recharges.length} 次 · {formatUsd(finance.rechargeCents)}</strong></div><div><span>出金</span><strong>{formatUsd(finance.withdrawalCents)}</strong></div><div className="reception-progress-net"><span>当前净业绩</span><strong>{formatUsd(finance.netCents)}</strong></div><small>{lead.registeredOn ? `已注册 · ${lead.registeredOn}` : "未注册"}{lead.customerOrder && !lead.customerOrder.voidedAt ? ` · 已开单 ${lead.customerOrder.openedOn}` : " · 未开单"}</small></div></td>
            <td><div className="reception-progress-actions"><button type="button" onClick={() => void open(lead)} className="reception-progress-detail"><Eye size={15} />查看资料 / 每日记录</button>{onVoidErroneousEntry ? <>{lead.invalid ? <span className="reception-progress-voided">已作废</span> : <button type="button" className="member-text-action danger whitespace-nowrap" disabled={actionDisabled?.(lead)} onClick={() => onVoidErroneousEntry(lead)}>标记误录</button>}</> : null}</div></td>
          </tr>;
        })}
        {!leads.length ? <tr><td colSpan={5}>没有匹配的客户</td></tr> : null}
      </tbody>
    </table></div>
    </> : null}

    <Drawer title={selected ? `${selected.phone} · 后续进度` : "后续进度"} open={Boolean(selected)} onClose={close} className="max-w-2xl">
      <div className="space-y-5 p-5">
        {loading ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">正在加载每日记录…</p> : null}
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
        {detail ? <>
          {selected ? <CustomerProfileDetails lead={selected} /> : null}
          {selected ? (() => { const finance = financialSummary(selected); return <section className="grid gap-2 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm sm:grid-cols-2"><p className="m-0"><strong>首充：</strong>{formatUsd(finance.initialCents)}</p><p className="m-0"><strong>续充：</strong>{finance.recharges.length} 次 · {formatUsd(finance.rechargeCents)}</p><p className="m-0"><strong>出金：</strong>{formatUsd(finance.withdrawalCents)}</p><p className="m-0 sm:col-span-2"><strong>当前净业绩：</strong>{formatUsd(finance.netCents)}（首充 + 续充 − 出金）</p>{finance.recharges.map((event, index) => <p key={event.id} className="m-0 sm:col-span-2">第 {index + 1} 次续充：{event.occurredOn} · {formatUsd(event.amountCents ?? 0)}</p>)}</section>; })() : null}
          <section className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
            <p className="m-0"><strong>炒群负责人：</strong>{detail.customer.groupOperatorName ?? "待分配"}</p>
            <p className="m-0"><strong>专家负责人：</strong>{detail.customer.expertOwner?.name ?? "待分配"}</p>
            {(() => { const stage = resolveExpertWorkflowStage(detail.customer); const hours = expertWorkflowTrackingHours(detail.customer); return <><p className="m-0"><strong>专家当前阶段：</strong>{expertWorkflowStageLabel(stage)}{stage === "TRACKING" && hours !== null ? <span className={expertWorkflowTrackingOverdue(detail.customer) ? "font-semibold text-rose-700" : ""}> · 已追踪 {hours} 小时{expertWorkflowTrackingOverdue(detail.customer) ? "（超过 48 小时）" : ""}</span> : null}</p><p className="m-0"><strong>专家联系：</strong>{detail.customer.expertContactedOn ?? "尚未开始接待"}</p></>})()}
            <p className="m-0"><strong>当前结果：</strong>{detail.customer.hasActiveOrder ? "已开单" : detail.customer.registeredOn ? "已注册" : "未开单"}</p>
            <p className="m-0 sm:col-span-2"><strong>当前计划：</strong>{detail.customer.nextPlan ?? "尚未填写"}{detail.customer.nextFollowUpOn ? ` · ${detail.customer.nextFollowUpOn}` : ""}</p>
          </section>
          <section><h3 className="mb-2 text-sm font-bold text-slate-900">炒群每日进度</h3>
            {detail.groupProgress.length ? <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">{detail.groupProgress.map((item) => <div key={item.id} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[100px_1fr_100px]"><strong>{item.occurredOn}</strong><span>{item.note ?? "已更新"}</span><span className="text-xs text-slate-500 sm:text-right">{item.actor.name}</span></div>)}</div> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">暂无炒群每日进度。</p>}
          </section>
          <section><h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-900"><NotePencil size={16} />专家每日备注与进度</h3>
            {detail.expertProgress.length ? <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">{detail.expertProgress.map((item) => <div key={item.id} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[100px_90px_1fr_100px]"><strong>{item.occurredOn}</strong><span className="text-blue-700">{expertKindLabel[item.kind]}</span><span>{item.note ?? "已更新"}</span><span className="text-xs text-slate-500 sm:text-right">{item.actor.name}</span></div>)}</div> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">暂无专家每日备注。</p>}
          </section>
        </> : null}
      </div>
    </Drawer>
  </section>;
}
